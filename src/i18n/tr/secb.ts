/** Turkish strings added by the security fixes, area secb (stock ledger, cost periods, write paths). Key = English source text. */
export const secb: Record<string, string> = {
};

/** Server messages (DomainError, validation) of area secb. Key = the English message; {0}, {1} … = dynamic parts. */
export const secbMessages: Record<string, string> = {
  "Postings dated before the closed period {0} are not allowed": "Kapatılmış {0} döneminden önceye tarihli kayıt yapılamaz",
  "Cost period {0} is {1}; changes are not allowed": "{0} maliyet dönemi {1} durumunda; değişiklik yapılamaz",
  "This idempotency key was already used for a different stock movement": "Bu tekrar koruma anahtarı başka bir stok hareketi için kullanılmış",
};
