/* global process, console */
/**
 * CI security gate: `npm audit --omit=dev`, failing on any HIGH or CRITICAL advisory that is not accepted below.
 * An accepted advisory carries its reason and a review date; after that date it fails the build again, so an
 * exception cannot be forgotten. Add an entry only when the fix needs a major migration and the risk is understood.
 *   node scripts/ci/audit-gate.mjs
 */
import { execSync } from "node:child_process";

const ACCEPTED = {
  // zod 3.x: the fix exists only in zod 4 (a major migration of every schema). Request bodies are capped at 5 MB
  // before any schema runs (src/server/http/handler.ts MAX_BODY), which bounds the memory a payload can take.
  "GHSA-mrhx-c7xc-m3w5": { pkg: "zod", until: "2027-01-31", reason: "fix only in zod 4 (major); JSON bodies capped at 5 MB" },
  // deepmerge-ts inside the prisma CLI's config loader: runs at build/migrate time on our own config, never on
  // request data. The fix needs prisma 7 (major).
  "GHSA-ggr8-5vv4-36mx": { pkg: "deepmerge-ts", until: "2027-01-31", reason: "prisma CLI build-time only; fix needs prisma 7 (major)" },
};

let raw;
try {
  raw = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout
  raw = e.stdout;
}
const report = JSON.parse(raw);
if (report.error) {
  console.error("npm audit failed:", report.error.summary ?? report.error);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const seen = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === "string" || !["high", "critical"].includes(via.severity)) continue;
    const id = String(via.url ?? "").split("/").pop();
    seen.set(id, { id, pkg: via.name, severity: via.severity, title: via.title, url: via.url });
  }
}

const failing = [];
for (const a of seen.values()) {
  const ok = ACCEPTED[a.id];
  if (ok && today <= ok.until) console.log(`accepted  ${a.severity.padEnd(8)} ${a.pkg} ${a.id} until ${ok.until}: ${ok.reason}`);
  else {
    failing.push(a);
    console.error(`FAIL      ${a.severity.padEnd(8)} ${a.pkg} ${a.id}${ok ? ` (acceptance expired ${ok.until})` : ""}: ${a.title} ${a.url}`);
  }
}
const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit --omit=dev: ${Object.entries(counts).filter(([k, n]) => k !== "total" && n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing found"}`);
if (failing.length) {
  console.error(`\n${failing.length} high/critical advisory(ies) in production dependencies. Upgrade, or accept with a reason and a review date in scripts/ci/audit-gate.mjs.`);
  process.exit(1);
}
console.log("audit gate passed: no unaccepted high or critical advisory");
