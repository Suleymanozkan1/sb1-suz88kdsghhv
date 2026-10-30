/** Turkish strings of fix round b (demo on billed installations, access removal, allocation scope, billing, plan gates). Key = English source text. */
export const fixB: Record<string, string> = {
  "Next notice bills {n} hotels (most active since the last notice)": "Sonraki bildirim {n} otel üzerinden kesilir (son bildirimden beri en yüksek aktif otel sayısı)",
  "{n} hotels billed": "{n} otel faturalandı",
  "Your company uses the {plan}. Nothing was deleted: everything recorded here is kept and is back on this screen as soon as the package includes it again.": "Şirketiniz {plan} kullanıyor. Hiçbir veri silinmedi: burada kaydedilen her şey saklanıyor ve paketiniz bu modülü yeniden içerdiğinde bu ekranda tekrar görünür.",
  "Until then you can download its figures as CSV.": "O zamana kadar bu modülün rakamlarını CSV olarak indirebilirsiniz.",
  "Download CSV": "CSV indir",
  "Demo data is not available on a billed installation: load it on a separate demo deployment": "Faturalı bir kurulumda demo veri yüklenemez: demo veriyi ayrı bir demo kurulumuna yükleyin",
};

/** Server messages (DomainError, validation) of fix round b. Key = the English message; {0}, {1} … = dynamic parts. */
export const fixBMessages: Record<string, string> = {
  "Cost allocation is hotel-wide: needs an all-department role": "Maliyet dağıtımı otel genelidir: tüm departmanları kapsayan bir rol gerekir",
  "Demo data is not available on a billed installation: load it on a separate demo deployment": "Faturalı bir kurulumda demo veri yüklenemez: demo veriyi ayrı bir demo kurulumuna yükleyin",
};
