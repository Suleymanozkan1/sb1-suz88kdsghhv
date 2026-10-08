/**
 * Where purchase invoices come from (INVOICE_SOURCE):
 *   web  — the Micros purchasing web screens (src/screens/micros/invoices.ts), read in the same browser session
 *   file — CSV/XLSX exports dropped into INVOICE_IMPORT_DIR (src/invoices/fileReader.ts), for hotels whose
 *          purchasing runs in a desktop program or where an export is easier than reading screens
 * Another source (e.g. a database view) only needs to implement InvoiceReader.
 */
import type { Invoice } from "../contract";
import type { MicrosSelectors } from "../browser/selectors";
import type { Config } from "../config";
import type { DetailResult } from "../screens/listDetail";
import type { ScreenContext } from "../screens/context";
import { readInvoicesFromWeb } from "../screens/micros/invoices";
import { FileInvoiceReader } from "./fileReader";

export interface InvoiceReader {
  readonly name: "web" | "file";
  /** true: needs the signed-in Micros browser page */
  readonly needsBrowser: boolean;
  /** ingest "source" field for these invoices */
  readonly ingestSource: "MICROS" | "OTHER";
  read(day: string, micros?: ScreenContext<MicrosSelectors>): Promise<DetailResult<Invoice>>;
  /** called after the invoices were posted successfully (not in dry-run), e.g. to archive imported files */
  commit?(day: string): Promise<void>;
}

export class WebInvoiceReader implements InvoiceReader {
  readonly name = "web" as const;
  readonly needsBrowser = true;
  readonly ingestSource = "MICROS" as const;
  async read(_day: string, micros?: ScreenContext<MicrosSelectors>): Promise<DetailResult<Invoice>> {
    if (!micros) throw new Error("web invoice reader needs the Micros browser session");
    return readInvoicesFromWeb(micros);
  }
}

export function createInvoiceReader(config: Config): InvoiceReader {
  return config.invoiceSource === "file" ? new FileInvoiceReader(config.invoiceImportDir, config.timezone) : new WebInvoiceReader();
}
