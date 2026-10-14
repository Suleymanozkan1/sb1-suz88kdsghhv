/** Turkish strings of the security fixes, area c (permission and department scope of reads). Key = English source text. */
export const secc: Record<string, string> = {
  // audit trail: a row about a record the user may not read (other department, no permission for its screen)
  "Details are not visible with your permissions": "Ayrıntılar yetkileriniz kapsamında görüntülenemez",
  // full-cost export: supplier price sections without the purchase:prices permission
  "No purchase:prices permission.": "purchase:prices (satın alma fiyatları) yetkisi yok.",
};

/** Server messages (DomainError, validation) of area c. Key = the English message; {0}, {1} … = dynamic parts. */
export const seccMessages: Record<string, string> = {
};
