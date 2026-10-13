/** Turkish strings added in feedback round 3, area r3f. Key = English source text. */
export const r3f: Record<string, string> = {
  // kind name in the automation log's counts ("Ödenmez / İkram: 2 received …")
  "ingest:comps": "Ödenmez / İkram",
  "Runs every night at 05:00 on the office computer where the Micros reporting is installed. If the night audit has not finished yet, it tries again every 15 minutes until 09:00 (the times can be changed in the automation's settings).":
    "Her gece 05:00'te, Micros raporlamasının kurulu olduğu ofis bilgisayarında çalışır. Gece kapanışı henüz bitmemişse 09:00'a kadar 15 dakikada bir yeniden dener (saatler otomasyonun ayarlarından değiştirilebilir).",
};

/** Server messages (DomainError, validation) of area r3f. Key = the English message; {0}, {1} … = dynamic parts. */
export const r3fMessages: Record<string, string> = {
};
