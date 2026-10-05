import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { buildFullCostExport } from "../src/server/services/export";
import { actorForUser } from "../src/server/auth/actors";
import { parseExportParams } from "../src/server/excel";
import { TR } from "../src/i18n/tr";
const db = new PrismaClient();
(async () => {
  const u = await db.user.findUniqueOrThrow({ where: { email: "controller@test.local" } });
  const actor = (await actorForUser(u.id))!;
  const vals = new Map<string, Set<string>>();
  for (const h of actor.hotelIds) {
    const e = await buildFullCostExport(db as never, actor, h, parseExportParams(new URLSearchParams("from=2026-09-01&to=2026-09-30")), { noArchive: true } as never);
    writeFileSync("/tmp/claude-0/s/export.json", JSON.stringify(e));
    for (const s of Object.values(e.sections)) for (const c of s.columns) if (c.type === "text") for (const r of s.rows) {
      const v = r[c.key]; if (!v) continue;
      const k = `${s.key}.${c.key}`; if (!vals.has(k)) vals.set(k, new Set()); vals.get(k)!.add(v);
    }
    for (const c of e.checks) { const k = "checks"; if (!vals.has(k)) vals.set(k, new Set()); vals.get(k)!.add(c.check); vals.get(k)!.add(c.status); if (c.note) vals.get(k)!.add(c.note); }
    for (const [k, v] of Object.entries(e.summary)) { if (!vals.has("summary")) vals.set("summary", new Set()); vals.get("summary")!.add(v.status); if (v.note) vals.get("summary")!.add(v.note); }
  }
  for (const [k, s] of vals) {
    const arr = [...s];
    const miss = arr.filter((v) => !TR[v] && /[A-Za-z]/.test(v) && !/[çğıöşüÇĞİÖŞÜ]/.test(v));
    if (miss.length) console.log(k, arr.length, JSON.stringify(miss.slice(0, 12)));
  }
  await db.$disconnect();
})();
