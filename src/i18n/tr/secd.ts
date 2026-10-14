/** Turkish strings of the security fixes, area d (resource limits). Key = English source text. */
export const secd: Record<string, string> = {};

/** Server messages (DomainError, validation) of area d. Key = the English message; {0}, {1} … = dynamic parts. */
export const secdMessages: Record<string, string> = {
  "{0}: the recipe expands to more than {1} lines through its sub-recipes": "{0}: reçete alt reçeteleriyle birlikte {1} satırdan fazlasına açılıyor",
  "This change would nest the sub-recipes of {0} deeper than {1} levels": "Bu değişiklikle {0} reçetesinin alt reçeteleri {1} seviyeden daha derin iç içe geçer",
  "This change would make recipe {0} expand to more than {1} lines through its sub-recipes": "Bu değişiklikle {0} reçetesi alt reçeteleriyle birlikte {1} satırdan fazlasına açılır",
  "A recipe can have at most 200 lines": "Bir reçetede en fazla 200 satır olabilir",
  "The file has more than {0} rows": "Dosyada {0} satırdan fazla var",
  "The file has more than {0} columns": "Dosyada {0} sütundan fazla var",
  "The file has more than {0} cells: split it into smaller files": "Dosyada {0} hücreden fazla var: dosyayı daha küçük dosyalara bölün",
  "The Excel file is too large or declares too large ranges: save the data as a plain .xlsx or CSV and try again":
    "Excel dosyası çok büyük ya da çok büyük aralıklar tanımlıyor: verileri sade bir .xlsx veya CSV olarak kaydedip tekrar deneyin",
};
