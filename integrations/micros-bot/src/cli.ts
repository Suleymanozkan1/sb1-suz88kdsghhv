#!/usr/bin/env node
/**
 * HotelCost Micros/Opera bot — command line.
 *
 *   run [--day=YYYY-MM-DD] [--only=checks,invoices,covers,minibar,occupancy,products] [--dry-run]
 *   daemon                 nightly run at RUN_AT + "Şimdi çalıştır" polling
 *   check-config [--login] show the configuration (secrets masked), TODO selectors, reachability;
 *                          --login also tries to sign in to Micros / Opera
 *
 * Exit codes: 0 ok, 1 run failed / config problems, 2 usage error.
 */
import { buildConfig, configWarnings, loadEnv, maskedConfig, secretsOf, validateConfig, type Config } from "./config";
import { ALL_KINDS, type Kind } from "./contract";
import { configureLogger, log } from "./logger";
import { runBot } from "./runner";
import { Daemon } from "./daemon";
import { findTodos, loadSelectors, type MicrosSelectors, type OperaSelectors } from "./browser/selectors";
import { HotelCostClient } from "./hotelcost/client";
import { defaultBusinessDay, isValidDay } from "./util/time";
import { describeError } from "./errors";
import { openBrowser } from "./browser/session";
import { microsLogin } from "./screens/micros/login";
import { operaLogin } from "./screens/opera/statistics";
import { FileInvoiceReader } from "./invoices/fileReader";

const USAGE = `Kullanım:
  run [--day=YYYY-MM-DD] [--only=${ALL_KINDS.join(",")}] [--dry-run]
  daemon
  check-config [--login]`;

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | true> } {
  const [command = "", ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) throw new Error(`unknown argument "${a}"`);
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (rest[i + 1] && !rest[i + 1]!.startsWith("--") && ["day", "only"].includes(a.slice(2))) flags[a.slice(2)] = rest[++i]!;
    else flags[a.slice(2)] = true;
  }
  return { command, flags };
}

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const { command, flags } = parsed;
  const config = buildConfig(loadEnv());
  configureLogger({ secrets: secretsOf(config), level: config.logLevel });

  if (command === "check-config") return checkConfig(config, flags.login === true);

  if (command !== "run" && command !== "daemon") {
    console.error(USAGE);
    return 2;
  }
  const problems = validateConfig(config);
  if (problems.length) {
    for (const p of problems) log.error(`config: ${p}`);
    if (!(command === "run" && flags["dry-run"] && problems.every((p) => /HOTELCOST_/.test(p)))) return 1;
  }

  if (command === "run") {
    const dryRun = flags["dry-run"] === true;
    if (dryRun) configureLogger({ stderr: true });
    let day: string | undefined;
    if (flags.day !== undefined) {
      if (typeof flags.day !== "string" || !isValidDay(flags.day)) {
        console.error(`--day must be YYYY-MM-DD\n${USAGE}`);
        return 2;
      }
      day = flags.day;
    }
    let only: Kind[] | undefined;
    if (flags.only !== undefined) {
      const list = String(flags.only).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const bad = list.filter((k) => !ALL_KINDS.includes(k as Kind));
      if (bad.length || list.length === 0) {
        console.error(`--only: unknown kind(s) ${bad.join(", ")} (valid: ${ALL_KINDS.join(", ")})`);
        return 2;
      }
      only = list as Kind[];
    }
    const report = await runBot(config, { day, only, dryRun });
    return report.ok ? 0 : 1;
  }

  const daemon = new Daemon(config);
  daemon.start();
  await new Promise<void>((resolve) => {
    const stop = (sig: string) => {
      log.info(`${sig} received, stopping after the current run`);
      void daemon.stop().then(() => resolve());
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  });
  return 0;
}

async function checkConfig(config: Config, tryLogin: boolean): Promise<number> {
  const out = (s = "") => console.log(s);
  let bad = 0;
  out("Yapılandırma (gizli değerler maskeli):");
  out(JSON.stringify(maskedConfig(config), null, 2));
  out();
  const problems = validateConfig(config);
  for (const p of problems) out(`HATA   ${p}`);
  for (const w of configWarnings(config)) out(`UYARI  ${w}`);
  bad += problems.length;
  out(`Bugün çalışılırsa varsayılan iş günü: ${defaultBusinessDay(new Date(), config.timezone, config.nightAuditCutoff)}`);

  const selectorFiles: Array<[string, string]> = [["Micros", config.micros.selectorsFile]];
  if (config.opera) selectorFiles.push(["Opera", config.opera.selectorsFile]);
  for (const [name, file] of selectorFiles) {
    try {
      const sel = loadSelectors<Record<string, unknown>>(file);
      let todos = findTodos(sel);
      if (name === "Micros" && config.invoiceSource === "file") todos = todos.filter((t) => !t.startsWith("invoices"));
      if (todos.length) {
        bad++;
        out(`HATA   ${name} seçicileri (${file}) içinde doldurulmamış ${todos.length} TODO var:`);
        for (const t of todos) out(`         - ${t}`);
      } else out(`OK     ${name} seçicileri: ${file}`);
    } catch (err) {
      bad++;
      out(`HATA   ${(err as Error).message}`);
    }
  }

  if (config.invoiceSource === "file") {
    try {
      const files = new FileInvoiceReader(config.invoiceImportDir).listFiles();
      out(`OK     Fatura klasörü ${config.invoiceImportDir} (${files.length} dosya bekliyor)`);
    } catch (err) {
      bad++;
      out(`HATA   ${(err as Error).message}`);
    }
  }

  if (config.hotelcost.url && config.hotelcost.apiKey) {
    try {
      await new HotelCostClient({ baseUrl: config.hotelcost.url, apiKey: config.hotelcost.apiKey, retries: 0 }).nextRequest();
      out(`OK     HotelCost erişilebilir, API anahtarı kabul edildi (${config.hotelcost.url})`);
    } catch (err) {
      bad++;
      out(`HATA   HotelCost: ${describeError(err)}`);
    }
  }
  for (const [name, url] of [["Micros", config.micros.url], ["Opera", config.opera?.url ?? ""]] as const) {
    if (!url) continue;
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000) });
      out(`OK     ${name} adresine ulaşıldı (${url} → HTTP ${res.status})`);
    } catch (err) {
      bad++;
      out(`HATA   ${name} adresine ulaşılamadı (${url}): ${describeError(err)}`);
    }
  }

  if (tryLogin) {
    const session = await openBrowser(config).catch((err) => {
      bad++;
      out(`HATA   Tarayıcı açılamadı: ${describeError(err)} (npx playwright install chromium)`);
      return undefined;
    });
    if (session) {
      try {
        const base = { page: session.page, day: defaultBusinessDay(new Date(), config.timezone, config.nightAuditCutoff), timezone: config.timezone, timeoutMs: config.timeoutMs };
        try {
          await microsLogin({ ...base, selectors: loadSelectors<MicrosSelectors>(config.micros.selectorsFile), baseUrl: config.micros.url }, config.micros);
          out("OK     Micros girişi başarılı");
        } catch (err) {
          bad++;
          out(`HATA   Micros girişi: ${describeError(err)}`);
        }
        if (config.opera) {
          try {
            await operaLogin({ ...base, selectors: loadSelectors<OperaSelectors>(config.opera.selectorsFile), baseUrl: config.opera.url }, config.opera);
            out("OK     Opera girişi başarılı");
          } catch (err) {
            bad++;
            out(`HATA   Opera girişi: ${describeError(err)}`);
          }
        }
      } finally {
        await session.close();
      }
    }
  }
  out();
  out(bad ? `${bad} sorun bulundu.` : "Her şey hazır.");
  return bad ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log.error(`fatal: ${describeError(err)}`);
    process.exit(1);
  },
);
