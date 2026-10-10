/** Turkish UI strings, keyed by the English source text. One file per area keeps parallel edits apart. */
import { common } from "./common";
import { shell } from "./shell";
import { stock } from "./stock";
import { ops } from "./ops";
import { planning } from "./planning";
import { server } from "./server";
import { reports } from "./reports";
import { setup } from "./setup";
import { exports } from "./exports";
import { XL_UI } from "./excel";
import { r2a } from "./r2a";
import { r2b } from "./r2b";
import { r2c } from "./r2c";
import { r2d } from "./r2d";
import { r2e } from "./r2e";
import { r2f } from "./r2f";

export const TR: Record<string, string> = { ...common, ...shell, ...stock, ...ops, ...planning, ...server, ...reports, ...setup, ...exports, ...XL_UI, ...r2a, ...r2b, ...r2c, ...r2d, ...r2e, ...r2f };
