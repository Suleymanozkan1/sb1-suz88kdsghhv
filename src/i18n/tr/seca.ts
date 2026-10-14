/** Turkish strings of the security fixes, area seca (authentication, API tokens, tenancy). Key = English source text. */
export const seca: Record<string, string> = {
  // Excel export: personal API tokens
  "Revoke all your API tokens? Excel then asks for a new one.": "Tüm API anahtarlarınız iptal edilsin mi? Excel daha sonra yeni bir anahtar ister.",
  "Revoke all my tokens": "Tüm anahtarlarımı iptal et",
  "{count} token(s) revoked.": "{count} anahtar iptal edildi.",
  // platform console
  "Release a login e-mail": "Giriş e-postasını serbest bırak",
  "A login e-mail belongs to one user across all companies. If a company took an address that another company needs, release it here: that user is deactivated and renamed (audited in the company's trail).":
    "Bir giriş e-postası tüm şirketlerde tek bir kullanıcıya aittir. Bir şirket, başka bir şirketin ihtiyaç duyduğu bir adresi aldıysa buradan serbest bırakın: o kullanıcı pasifleştirilir ve yeniden adlandırılır (şirketin denetim kaydına yazılır).",
  "Release": "Serbest bırak",
  "The e-mail address is free: its user was deactivated and renamed.": "E-posta adresi serbest: kullanıcısı pasifleştirildi ve yeniden adlandırıldı.",
  // audit actions
  "API_TOKEN_REVOKE": "API anahtarları iptal edildi",
  "PLATFORM_EMAIL_RELEASE": "Giriş e-postası serbest bırakıldı",
};

/** Server messages (DomainError, validation) of area seca. Key = the English message; {0}, {1} … = dynamic parts. */
export const secaMessages: Record<string, string> = {
  "Request body is too large": "İstek gövdesi çok büyük",
  "An API token can only be used for the Excel export": "API anahtarı yalnızca Excel dışa aktarımı için kullanılabilir",
  "No company user has this e-mail address": "Bu e-posta adresine sahip bir şirket kullanıcısı yok",
};
