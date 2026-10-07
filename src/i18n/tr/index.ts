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

export const TR: Record<string, string> = { ...common, ...shell, ...stock, ...ops, ...planning, ...server, ...reports, ...setup, ...exports };
