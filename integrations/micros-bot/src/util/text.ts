/** Column header → comparable key: lower case, Turkish letters folded, only letters and digits ("KDV %" → "kdv"). */
export function normalizeHeader(h: string): string {
  return h
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
