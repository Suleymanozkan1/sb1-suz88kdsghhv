/** Turkish strings added in the audit remediation round, area e (menu, roles, page titles, audit diffs). Key = English source text. */
export const fixE: Record<string, string> = {
  // role descriptions (Administration → users and invitations)
  "Everything in the company: users, hotels, settings and every module.": "Şirketteki her şey: kullanıcılar, oteller, ayarlar ve tüm modüller.",
  "Every cost module of all departments, including period closing and approvals; no user or hotel management.": "Tüm departmanların bütün maliyet modülleri, dönem kapatma ve onaylar dahil; kullanıcı ve otel yönetimi yok.",
  "Food and beverage departments: costs, recipes and their approval, stock, waste, breakfast, minibar and approvals.": "Yiyecek ve içecek departmanları: maliyetler, reçeteler ve onayı, stok, fire, kahvaltı, minibar ve onaylar.",
  "Cost periods, budget, operating costs, allocation and reports of all departments; no stock entry.": "Tüm departmanların maliyet dönemleri, bütçesi, işletme giderleri, dağıtımı ve raporları; stok girişi yok.",
  "Suppliers, prices, purchase orders, goods receipts and products.": "Tedarikçiler, fiyatlar, satın alma siparişleri, mal kabul ve ürünler.",
  "Kitchen and outlets of their departments: recipes, stock movements and counts, waste, breakfast, theoretical vs actual and reports.": "Kendi departmanlarının mutfağı ve satış noktaları: reçeteler, stok hareketleri ve sayımlar, fire, kahvaltı, teorik ve gerçekleşen, raporlar.",
  "Breakfast and buffet of their departments: breakfast days and counts, breakfast recipes, requisitions from the store, stock counts and waste. No theoretical vs actual or menu engineering.": "Kendi departmanlarının kahvaltı ve büfesi: kahvaltı günleri ve sayımları, kahvaltı reçeteleri, depodan malzeme çekme, stok sayımı ve fire. Teorik ve gerçekleşen ile menü mühendisliği yok.",
  "Pastry of their departments: recipes, stock movements and counts, waste, theoretical vs actual and reports.": "Kendi departmanlarının pastanesi: reçeteler, stok hareketleri ve sayımlar, fire, teorik ve gerçekleşen, raporlar.",
  "Rooms, housekeeping and laundry: room cost, operating costs, minibar, stock and waste of their departments.": "Odalar, kat hizmetleri ve çamaşırhane: kendi departmanlarının oda maliyeti, işletme giderleri, minibar, stok ve firesi.",
  "Sees every module of all departments, changes nothing.": "Tüm departmanların bütün modüllerini görür, hiçbir şeyi değiştirmez.",
  "Stores: goods receipts, transfers, issues, counts and minibar refills.": "Depolar: mal kabul, transfer, çıkış, sayım ve minibar dolumu.",
  // /forbidden for hotel-wide pages (forecast, what-if, cost allocation)
  "hotel-wide figures: needs a role with access to all departments": "otel geneli rakamlar: tüm departmanlara erişimi olan bir rol gerekir",
  // browser tab titles (generateMetadata → pageTitle)
  "Cost Control Calendar": "Maliyet Kontrol Takvimi",
  "No hotel access": "Otel erişimi yok",
  "Accept invitation": "Daveti kabul et",
  "Explains, line by line, the difference between what a hotel bought and what its recipes should have used.": "Otelin satın aldığı ile reçetelerine göre kullanması gereken arasındaki farkı kalem kalem açıklar.",
  // /savings: no "API" or internal metric code in the assumptions line
  "Default assumptions: waste avoidable {waste} %, unexplained usage recoverable {unexplained} %, carrying cost {carrying} %/year, energy {energy} %, OTA → direct {ota} %, labor efficiency {labor} % (a labor cost % target, when set, replaces it).":
    "Varsayılan varsayımlar: önlenebilir fire %{waste}, geri kazanılabilir açıklanamayan kullanım %{unexplained}, stok tutma maliyeti yıllık %{carrying}, enerji %{energy}, OTA'dan doğrudan satışa geçiş %{ota}, personel verimliliği %{labor} (tanımlı bir personel maliyeti % hedefi varsa onun yerine geçer).",
  // audit trail: readable changes ("Field: old → new")
  "Changes": "Değişiklikler",
  "changed to": "yeni değer",
  "Recorded value": "Kayıtlı değer",
  "{n} lines": "{n} satır",
  "Par level": "Par stok",
  "Notes": "Notlar",
  "Warning level": "Uyarı düzeyi",
  "Valid from": "Geçerlilik başlangıcı",
  "Valid to": "Geçerlilik bitişi",
  "File name": "Dosya adı",
  "In": "Giriş",
  "Out": "Çıkış",
  "Service date": "Servis tarihi",
  "Start time": "Başlangıç saati",
  "End time": "Bitiş saati",
  "Paid covers": "Ücretli kuver",
  "Included covers": "Pansiyona dahil kuver",
  "Actual saving": "Gerçekleşen tasarruf",
  "Baseline cost": "Başlangıç maliyeti",
  "Closed at": "Kapanış zamanı",
  "Decision": "Karar",
  "Store": "Depo",
  "Differences": "Farklar",
  // validation messages name the field (FE-08)
  "Subcategory": "Alt kategori",
};
