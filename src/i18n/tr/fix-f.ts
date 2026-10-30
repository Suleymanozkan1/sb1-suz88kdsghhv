/** Turkish strings of fix round f (own password change, reset by e-mail). Key = English source text. */
export const fixF: Record<string, string> = {
  // change while signed in (/account/password)
  "Change password": "Şifremi değiştir",
  "Current password": "Mevcut şifre",
  "New password": "Yeni şifre",
  "Repeat new password": "Yeni şifre tekrar",
  "Your password was changed.": "Şifreniz değiştirildi.",
  "Your password was changed. You were signed out on {n} other device(s).": "Şifreniz değiştirildi. Diğer {n} cihazdaki oturumunuz kapatıldı.",
  "Back to HotelCost": "HotelCost'a dön",
  // reset by e-mail (/forgot-password, /reset-password)
  "Forgot your password?": "Şifremi unuttum",
  "Forgot password": "Şifremi unuttum",
  "Enter the e-mail address you sign in with. If it belongs to an account, we send a link to choose a new password.":
    "Giriş yaptığınız e-posta adresini yazın. Adres bir hesaba aitse yeni şifre belirlemeniz için bir bağlantı göndeririz.",
  "Send reset link": "Sıfırlama bağlantısı gönder",
  "Sending…": "Gönderiliyor…",
  "If the address belongs to an active account, a reset link is on its way. Check your inbox and spam folder; the link is valid for {minutes} minutes.":
    "Adres etkin bir hesaba aitse sıfırlama bağlantısı gönderildi. Gelen kutunuzu ve istenmeyen klasörünü kontrol edin; bağlantı {minutes} dakika geçerlidir.",
  "Back to sign in": "Giriş sayfasına dön",
  "Choose a new password": "Yeni şifre belirleyin",
  "Set new password": "Yeni şifreyi kaydet",
  "Request a new link": "Yeni bağlantı iste",
  "This password reset link is invalid, already used or expired": "Bu şifre sıfırlama bağlantısı geçersiz, kullanılmış ya da süresi dolmuş",
  "Your password was changed. Sign in with the new one.": "Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.",
  // audit trail action codes
  "LOGIN_FAILED": "Başarısız giriş",
  "PASSWORD_CHANGE": "Şifre değiştirildi",
  "PASSWORD_CHANGE_FAILED": "Şifre değiştirme başarısız",
  "PASSWORD_RESET_REQUEST": "Şifre sıfırlama istendi",
  "PASSWORD_RESET": "Şifre sıfırlandı",
  // the reset e-mail
  "Reset your HotelCost password": "HotelCost şifrenizi sıfırlayın",
  "Hello {name},\n\nA new password was requested for your HotelCost account {email}. Open this link within {minutes} minutes to choose it:\n\n{link}\n\nThe link works once. If you did not ask for this, ignore this e-mail: your password stays as it is.":
    "Merhaba {name},\n\nHotelCost hesabınız ({email}) için yeni şifre istendi. Yeni şifrenizi belirlemek için bu bağlantıyı {minutes} dakika içinde açın:\n\n{link}\n\nBağlantı yalnızca bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı dikkate almayın: şifreniz değişmez.",
};

/** Server messages (DomainError, validation) of round f. Key = the English message. */
export const fixFMessages: Record<string, string> = {
  "Passwords do not match": "Şifreler eşleşmiyor",
  "The current password is not correct": "Mevcut şifre doğru değil",
  "The new password must be different from the current one": "Yeni şifre mevcut şifreden farklı olmalı",
  "The password was changed in the meantime: sign in again": "Şifre bu arada değiştirildi: yeniden giriş yapın",
  "Password reset by e-mail is not available: ask your administrator": "E-postayla şifre sıfırlama kullanılamıyor: yöneticinize başvurun",
  "This password reset link is invalid, already used or expired": "Bu şifre sıfırlama bağlantısı geçersiz, kullanılmış ya da süresi dolmuş",
};
