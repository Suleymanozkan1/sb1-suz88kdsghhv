/**
 * HotelCost on-premise setup (Windows installer; also runs on Linux for testing).
 *
 * Layout (install dir):
 *   node/node.exe           Node.js runtime
 *   pgsql/bin|lib|share     PostgreSQL 16 (embedded build)
 *   app/                    Next.js standalone server (server.js), migrations, this setup (setup.cjs)
 *   HotelCostServer.exe     WinSW service wrapper (Windows)
 * Data dir (default C:\ProgramData\HotelCost): pgdata/, logs/, backups/, config.json
 *
 * Commands: install | start | stop | status | backup | demo | uninstall [--purge]
 * install is idempotent: it creates the database cluster once, applies new migrations on every run
 * (upgrades) and bootstraps the first company only when the database is empty.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Client } from "pg";

const WIN = process.platform === "win32";
const APP = path.resolve(__dirname);
const ROOT = path.resolve(APP, "..");
const PG_BIN = path.join(ROOT, "pgsql", "bin");
const exe = (name: string) => path.join(PG_BIN, WIN ? `${name}.exe` : name);
// Windows finds the DLLs next to the executables; Linux test builds need the bundled lib dir
if (!WIN) process.env.LD_LIBRARY_PATH = [path.join(ROOT, "pgsql", "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
const args = new Map(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k!, v ?? "true"] as [string, string]; }));
const DATA = path.resolve(args.get("data") ?? (WIN ? path.join(process.env.ProgramData ?? "C:\\ProgramData", "HotelCost") : path.join(ROOT, "data")));
const CONFIG = path.join(DATA, "config.json");
const DB_SERVICE = "HotelCostDB";
const APP_SERVICE = "HotelCostServer";

interface Config {
  dbPort: number;
  appPort: number;
  dbUser: string;
  dbPassword: string;
  sessionSecret: string;
  installedAt: string;
}

const log = (s: string) => console.log(`[HotelCost] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadConfig(): Config | null {
  return fs.existsSync(CONFIG) ? (JSON.parse(fs.readFileSync(CONFIG, "utf8")) as Config) : null;
}

function saveConfig(c: Config) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 });
}

const dbUrl = (c: Config, db = "hotelcost") => `postgresql://${c.dbUser}:${encodeURIComponent(c.dbPassword)}@127.0.0.1:${c.dbPort}/${db}`;

function appEnv(c: Config): Record<string, string> {
  return {
    DATABASE_URL: dbUrl(c),
    PORT: String(c.appPort),
    HOSTNAME: "0.0.0.0",
    NODE_ENV: "production",
    HOTELCOST_ENV: "production",
    SESSION_SECRET: c.sessionSecret,
    // on-premise installs are reached over plain HTTP on the hotel LAN unless a TLS proxy is configured
    INSECURE_COOKIES: "1",
  };
}

// ───────────────────────── database cluster ─────────────────────────

function initCluster(c: Config) {
  const pgdata = path.join(DATA, "pgdata");
  if (fs.existsSync(path.join(pgdata, "PG_VERSION"))) return;
  log("creating the database cluster…");
  fs.mkdirSync(pgdata, { recursive: true });
  const pw = path.join(DATA, ".pw");
  fs.writeFileSync(pw, c.dbPassword, { mode: 0o600 });
  try {
    execFileSync(exe("initdb"), ["-D", pgdata, "-U", c.dbUser, "-A", "scram-sha-256", `--pwfile=${pw}`, "-E", "UTF8", "--no-locale"], { stdio: "inherit" });
  } finally {
    fs.rmSync(pw, { force: true });
  }
  // the database service runs as NetworkService (pg_ctl register default): give it the data and log folders
  if (WIN) {
    fs.mkdirSync(path.join(DATA, "logs"), { recursive: true });
    for (const dir of [pgdata, path.join(DATA, "logs")]) execFileSync("icacls.exe", [dir, "/grant", "*S-1-5-20:(OI)(CI)F", "/T", "/Q"], { stdio: "inherit" });
  }
  // local connections only (the app runs on the same machine)
  fs.appendFileSync(path.join(pgdata, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nport = ${c.dbPort}\nmax_connections = 60\nshared_buffers = 256MB\n`);
}

function startDb(c: Config) {
  const pgdata = path.join(DATA, "pgdata");
  fs.mkdirSync(path.join(DATA, "logs"), { recursive: true });
  if (WIN) {
    try {
      execFileSync(exe("pg_ctl"), ["register", "-N", DB_SERVICE, "-D", pgdata, "-S", "auto"], { stdio: "inherit" });
    } catch {
      /* already registered */
    }
    try {
      execFileSync("sc.exe", ["start", DB_SERVICE], { stdio: "ignore" });
    } catch {
      /* already running */
    }
  } else {
    try {
      execFileSync(exe("pg_ctl"), ["status", "-D", pgdata], { stdio: "ignore" });
    } catch {
      execFileSync(exe("pg_ctl"), ["start", "-D", pgdata, "-l", path.join(DATA, "logs", "postgres.log"), "-w"], { stdio: "inherit" });
    }
  }
  void c;
}

function stopDb() {
  const pgdata = path.join(DATA, "pgdata");
  if (WIN) {
    try {
      execFileSync("sc.exe", ["stop", DB_SERVICE], { stdio: "ignore" });
    } catch {
      /* not running */
    }
  } else {
    try {
      execFileSync(exe("pg_ctl"), ["stop", "-D", pgdata, "-m", "fast", "-w"], { stdio: "inherit" });
    } catch {
      /* not running */
    }
  }
}

async function waitForDb(c: Config, db = "postgres") {
  for (let i = 0; i < 60; i++) {
    const client = new Client({ connectionString: dbUrl(c, db) });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("PostgreSQL did not start - see logs/postgres.log");
}

// ───────────────────────── migrations (Prisma-compatible) ─────────────────────────

async function migrate(c: Config) {
  const admin = new Client({ connectionString: dbUrl(c, "postgres") });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'hotelcost'");
  if (!exists.rowCount) await admin.query("CREATE DATABASE hotelcost ENCODING 'UTF8' TEMPLATE template0");
  await admin.end();
  const db = new Client({ connectionString: dbUrl(c) });
  await db.connect();
  // the same bookkeeping table Prisma uses, so `prisma migrate deploy` stays usable for upgrades
  await db.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  const done = new Set((await db.query<{ migration_name: string }>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => r.migration_name));
  const dir = path.join(APP, "prisma", "migrations");
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "migration.sql"))).sort();
  let applied = 0;
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    const id = randomUUID();
    log(`migration ${name}`);
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`, [id, createHash("sha256").update(sql).digest("hex"), name]);
      await db.query("COMMIT");
      applied++;
    } catch (e) {
      await db.query("ROLLBACK");
      throw new Error(`migration ${name} failed: ${(e as Error).message}`);
    }
  }
  await db.end();
  log(applied ? `${applied} migration(s) applied` : "database schema is up to date");
}

// ───────────────────────── first company ─────────────────────────

/**
 * Line reader that also works with piped answers: readline drops lines that arrive before the question
 * is asked, and a closed stdin used to leave the question pending, so setup ended with exit code 0 and no company.
 */
function lineReader(rl: readline.Interface) {
  const lines: string[] = [];
  const waiting: Array<(l: string | null) => void> = [];
  let closed = false;
  rl.on("line", (l) => (waiting.length ? waiting.shift()!(l) : lines.push(l)));
  rl.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()!(null);
  });
  return (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      process.stdout.write(prompt);
      const done = (l: string | null) => (l === null ? reject(new Error("input ended before setup was complete - run setup again")) : resolve(l));
      if (lines.length) done(lines.shift()!);
      else if (closed) done(null);
      else waiting.push(done);
    });
}

async function ask(read: (prompt: string) => Promise<string>, q: string, def?: string, check?: (v: string) => string | null): Promise<string> {
  for (;;) {
    const a = (await read(`${q}${def ? ` [${def}]` : ""}: `)).trim() || def || "";
    const err = check ? check(a) : a ? null : "required";
    if (!err) return a;
    console.log(`  ✖ ${err}`);
  }
}

async function bootstrap(c: Config) {
  process.env.DATABASE_URL = dbUrl(c);
  const { PrismaClient } = (await import("@prisma/client")) as typeof import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (await prisma.organization.count()) {
      log("existing data found - the first company is already set up");
      return;
    }
    let input: Record<string, string>;
    if (args.has("admin-email")) {
      input = { organizationName: args.get("company") ?? "My Hotel Group", hotelCode: (args.get("hotel-code") ?? "HTL1").toUpperCase(), hotelName: args.get("hotel") ?? "My Hotel", totalRooms: args.get("rooms") ?? "0", baseCurrency: args.get("currency") ?? "TRY", adminEmail: args.get("admin-email")!, adminName: args.get("admin-name") ?? "Administrator", adminPassword: args.get("admin-password") ?? "" };
    } else {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      const read = lineReader(rl);
      console.log("\nFirst company and administrator (you can add hotels, users and departments later in Administration):");
      input = {
        organizationName: await ask(read, "Company name", "My Hotel Group"),
        hotelName: await ask(read, "Hotel name", "My Hotel"),
        hotelCode: (await ask(read, "Hotel code (letters/digits)", "HTL1", (v) => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(v) ? null : "letters, digits, - or _"))).toUpperCase(),
        totalRooms: await ask(read, "Number of rooms", "100", (v) => (/^\d+$/.test(v) ? null : "a number")),
        baseCurrency: (await ask(read, "Currency", "TRY", (v) => (/^[A-Za-z]{3}$/.test(v) ? null : "3 letters, e.g. TRY"))).toUpperCase(),
        adminName: await ask(read, "Administrator name", "Administrator"),
        adminEmail: await ask(read, "Administrator e-mail", undefined, (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "a valid e-mail")),
        adminPassword: await ask(read, "Administrator password (min 10 characters)", undefined, (v) => (v.length >= 10 ? null : "at least 10 characters")),
      };
      rl.close();
    }
    const { bootstrapInstallation } = await import("../src/server/services/admin");
    await bootstrapInstallation(prisma as never, input);
    log(`company "${input.organizationName}" created; sign in as ${input.adminEmail}`);
  } finally {
    await prisma.$disconnect();
  }
}

// ───────────────────────── application service ─────────────────────────

function writeServiceXml(c: Config) {
  const env = Object.entries(appEnv(c)).map(([k, v]) => `  <env name="${k}" value="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"/>`).join("\n");
  const xml = `<service>
  <id>${APP_SERVICE}</id>
  <name>HotelCost Server</name>
  <description>HotelCost cost-control web application (http://localhost:${c.appPort})</description>
  <executable>${path.join(ROOT, "node", "node.exe")}</executable>
  <arguments>server.js</arguments>
  <workingdirectory>${APP}</workingdirectory>
  <depend>${DB_SERVICE}</depend>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <logpath>${path.join(DATA, "logs")}</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
${env}
</service>
`;
  fs.writeFileSync(path.join(ROOT, `${APP_SERVICE}.xml`), xml, { mode: 0o600 });
}

function startApp(c: Config) {
  if (WIN) {
    writeServiceXml(c);
    const svc = path.join(ROOT, `${APP_SERVICE}.exe`);
    try {
      execFileSync(svc, ["install"], { stdio: "inherit" });
    } catch {
      /* already installed */
    }
    try {
      execFileSync(svc, ["start"], { stdio: "inherit" });
    } catch {
      /* already running */
    }
    return;
  }
  const pidFile = path.join(DATA, "app.pid");
  if (fs.existsSync(pidFile)) {
    try {
      process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0);
      return;
    } catch {
      /* stale */
    }
  }
  const out = fs.openSync(path.join(DATA, "logs", "app.log"), "a");
  const child = spawn(process.execPath, ["server.js"], { cwd: APP, env: { ...process.env, ...appEnv(c) }, detached: true, stdio: ["ignore", out, out] });
  fs.writeFileSync(pidFile, String(child.pid));
  child.unref();
}

function stopApp() {
  if (WIN) {
    try {
      execFileSync(path.join(ROOT, `${APP_SERVICE}.exe`), ["stop"], { stdio: "ignore" });
    } catch {
      /* not running */
    }
    return;
  }
  const pidFile = path.join(DATA, "app.pid");
  if (!fs.existsSync(pidFile)) return;
  try {
    process.kill(Number(fs.readFileSync(pidFile, "utf8")));
  } catch {
    /* gone */
  }
  fs.rmSync(pidFile, { force: true });
}

async function waitForApp(c: Config) {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${c.appPort}/api/health`);
      if (r.ok) return true;
    } catch {
      /* starting */
    }
    await sleep(1000);
  }
  return false;
}

// ───────────────────────── commands ─────────────────────────

async function install() {
  let c = loadConfig();
  if (!c) {
    c = { dbPort: Number(args.get("db-port") ?? 5433), appPort: Number(args.get("app-port") ?? 3000), dbUser: "hotelcost", dbPassword: randomBytes(18).toString("base64url"), sessionSecret: randomBytes(32).toString("base64url"), installedAt: new Date().toISOString() };
    saveConfig(c);
  }
  initCluster(c);
  startDb(c);
  await waitForDb(c);
  await migrate(c);
  await bootstrap(c);
  stopApp();
  startApp(c);
  log(`starting the web application on port ${c.appPort}…`);
  if (!(await waitForApp(c))) throw new Error(`the application did not answer on port ${c.appPort} - see ${path.join(DATA, "logs")}`);
  log(`ready: http://localhost:${c.appPort}  (from other computers on the network: http://<this-computer>:${c.appPort})`);
  if (WIN && !args.has("no-browser")) spawn("cmd.exe", ["/c", "start", "", `http://localhost:${c.appPort}`], { detached: true, stdio: "ignore" }).unref();
}

async function backup() {
  const c = loadConfig();
  if (!c) throw new Error("not installed");
  const target = path.join(DATA, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  log("stopping services for a consistent copy…");
  stopApp();
  stopDb();
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(DATA, "pgdata"), path.join(target, "pgdata"), { recursive: true });
  fs.copyFileSync(CONFIG, path.join(target, "config.json"));
  startDb(c);
  await waitForDb(c);
  startApp(c);
  log(`backup written to ${target}`);
}

async function demo() {
  const c = loadConfig();
  if (!c) throw new Error("not installed");
  process.env.DATABASE_URL = dbUrl(c);
  process.env.ALLOW_DEMO_DATA = "1";
  process.env.HOTELCOST_ENV = "demo";
  const { PrismaClient } = (await import("@prisma/client")) as typeof import("@prisma/client");
  const prisma = new PrismaClient();
  const { generateDemo } = await import("../src/server/demo/generate");
  const { PROFILES } = await import("../src/server/demo/profiles");
  log("loading demo companies (5 companies, 10 hotels) - this takes several minutes…");
  const s = await generateDemo(prisma as never, PROFILES[(args.get("profile") ?? "dev") as "dev"], { password: args.get("password") ?? "Demo!2026-QA", log: (x) => log(x) });
  log(`demo data loaded in ${s.seconds} s - sign in as companyadmin@test.local (password Demo!2026-QA)`);
  await prisma.$disconnect();
}

function uninstall() {
  stopApp();
  if (WIN) {
    try {
      execFileSync(path.join(ROOT, `${APP_SERVICE}.exe`), ["uninstall"], { stdio: "inherit" });
    } catch {
      /* not installed */
    }
  }
  stopDb();
  if (WIN) {
    try {
      execFileSync(exe("pg_ctl"), ["unregister", "-N", DB_SERVICE], { stdio: "inherit" });
    } catch {
      /* not registered */
    }
  }
  if (args.has("purge")) {
    fs.rmSync(DATA, { recursive: true, force: true });
    log("all data removed");
  } else log(`services removed; your data is kept in ${DATA}`);
}

async function main() {
  const cmd = process.argv[2] ?? "install";
  const c = loadConfig();
  switch (cmd) {
    case "install":
      return install();
    case "start":
      if (!c) throw new Error("not installed");
      startDb(c);
      await waitForDb(c);
      startApp(c);
      return void log((await waitForApp(c)) ? `running on http://localhost:${c.appPort}` : "starting… see logs");
    case "stop":
      stopApp();
      stopDb();
      return log("stopped");
    case "status":
      if (!c) return log("not installed");
      return log(`database port ${c.dbPort}, web http://localhost:${c.appPort}: ${(await waitForApp({ ...c })) ? "running" : "not answering"}`);
    case "backup":
      return backup();
    case "demo":
      return demo();
    case "uninstall":
      return uninstall();
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  console.error(`[HotelCost] ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
