import { TR } from "../src/i18n/tr";
const ks = process.argv.slice(2);
for (const k of ks) if (TR[k] === undefined) console.log("MISSING:", k);
