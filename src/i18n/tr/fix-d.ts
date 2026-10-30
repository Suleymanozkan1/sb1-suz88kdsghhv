/** Turkish strings of remediation fixes, area d (concurrency, bulk posting, export limits, nightly jobs). Key = English source text. */
export const fixD: Record<string, string> = {
  "One export covers at most {n} months on this server: for a longer period, export it in parts.": "Bu sunucuda bir dışa aktarma en fazla {n} ayı kapsar: daha uzun bir dönem için parça parça dışa aktarın.",
};

/** Server messages (DomainError, API errors) of area d. Key = the English message; {0}, {1} … = dynamic parts. */
export const fixDMessages: Record<string, string> = {
  "The system is busy with other changes right now: nothing was saved, please try again": "Sistem şu anda başka değişikliklerle meşgul: hiçbir şey kaydedilmedi, lütfen tekrar deneyin",
  "Choose a date range of at most {0} months for this export: longer ranges are too large to download here": "Bu dışa aktarma için en fazla {0} aylık bir tarih aralığı seçin: daha uzun aralıklar burada indirilemeyecek kadar büyük",
  "This export is {0} MB, more than the {1} MB that can be downloaded here: choose a shorter date range or a single department": "Bu dışa aktarma {0} MB ve burada indirilebilecek {1} MB sınırını aşıyor: daha kısa bir tarih aralığı ya da tek bir departman seçin",
};
