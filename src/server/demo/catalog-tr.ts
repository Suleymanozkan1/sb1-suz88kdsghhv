/**
 * Turkish display names for the demo dataset. The English source data in catalog.ts / profiles.ts stays the
 * generator's internal key (logic matches on it); only what is written to the database for people to read is
 * translated. Codes, SKUs, slugs, e-mail addresses and enum values never change with the locale.
 */
export type DemoLocale = "tr" | "en";

export const PRODUCT_TR: Record<string, string> = {
  // et
  "Beef Tenderloin": "Dana bonfile", "Beef Ribeye": "Dana antrikot", "Ground Beef": "Dana kıyma", "Lamb Leg": "Kuzu but", "Lamb Chops": "Kuzu pirzola",
  "Veal Shank": "Dana incik", "Beef Brisket": "Dana döş", Sucuk: "Sucuk", "Pastırma": "Pastırma", "Lamb Shoulder": "Kuzu kol",
  // tavuk
  "Chicken Breast": "Tavuk göğsü", "Chicken Thigh": "Tavuk but", "Whole Chicken": "Bütün tavuk", "Chicken Wings": "Tavuk kanat", "Turkey Breast": "Hindi göğsü",
  "Chicken Liver": "Tavuk ciğeri", "Chicken Drumstick": "Tavuk baget", "Smoked Turkey": "Füme hindi",
  // balık
  "Salmon Fillet": "Somon fileto", "Sea Bass": "Levrek", "Sea Bream": "Çipura", Turbot: "Kalkan", Anchovy: "Hamsi", "Tuna Loin": "Ton balığı fileto",
  "Smoked Salmon": "Füme somon", "Cod Fillet": "Morina fileto",
  // deniz ürünleri
  Shrimp: "Karides", Calamari: "Kalamar", Mussels: "Midye", Octopus: "Ahtapot", "King Prawns": "Jumbo karides", Scallops: "Deniz tarağı",
  // sebze
  Tomato: "Domates", Cucumber: "Salatalık", "Lettuce Iceberg": "Aysberg marul", Onion: "Kuru soğan", Garlic: "Sarımsak", Potato: "Patates", Carrot: "Havuç",
  "Bell Pepper": "Dolmalık biber", Eggplant: "Patlıcan", Zucchini: "Kabak", Mushroom: "Kültür mantarı", Spinach: "Ispanak", Rocket: "Roka", Parsley: "Maydanoz",
  "Fresh Mint": "Taze nane",
  // meyve
  Lemon: "Limon", Lime: "Misket limonu", Orange: "Portakal", Apple: "Elma", Banana: "Muz", Strawberry: "Çilek", Watermelon: "Karpuz", Grapes: "Üzüm",
  Pineapple: "Ananas", Avocado: "Avokado",
  // süt ürünleri
  "Whole Milk": "Tam yağlı süt", "Cooking Cream": "Pişirme kreması", Butter: "Tereyağı", Yoghurt: "Yoğurt", Ayran: "Ayran", Kaymak: "Kaymak",
  "Whipping Cream": "Şanti kreması", Eggs: "Yumurta",
  // peynir
  "White Cheese": "Beyaz peynir", "Kaşar": "Kaşar", Cheddar: "Cheddar peyniri", Mozzarella: "Mozzarella", Parmesan: "Parmesan peyniri", Mascarpone: "Mascarpone",
  "Tulum Cheese": "Tulum peyniri", Labneh: "Labne",
  // kuru gıda
  "Rice Baldo": "Baldo pirinç", Bulgur: "Bulgur", "Pasta Penne": "Penne makarna", Spaghetti: "Spagetti", Flour: "Un", Sugar: "Toz şeker",
  "Red Lentils": "Kırmızı mercimek", Chickpeas: "Nohut", Breadcrumbs: "Galeta unu", Oats: "Yulaf ezmesi",
  // yağ
  "Sunflower Oil": "Ayçiçek yağı", "Olive Oil Extra Virgin": "Natürel sızma zeytinyağı", "Frying Oil": "Kızartma yağı", Margarine: "Margarin",
  // baharat
  Salt: "Tuz", "Black Pepper": "Karabiber", "Red Pepper Flakes": "Pul biber", Cumin: "Kimyon", Oregano: "Kekik", Sumac: "Sumak", Paprika: "Toz kırmızı biber",
  Cinnamon: "Tarçın", Thyme: "Dağ kekiği",
  // sos
  Ketchup: "Ketçap", Mayonnaise: "Mayonez", Mustard: "Hardal", "Tomato Paste": "Domates salçası", "Pepper Paste": "Biber salçası", "Soy Sauce": "Soya sosu",
  "Pomegranate Molasses": "Nar ekşisi", "Balsamic Vinegar": "Balzamik sirke",
  // meşrubat
  "Cola 330ml": "Kola 330 ml", "Diet Cola 330ml": "Diyet kola 330 ml", "Lemon Soda": "Limonlu soda", "Still Water 500ml": "Su 500 ml", "Sparkling Water": "Maden suyu",
  "Orange Juice": "Portakal suyu", "Tonic Water": "Tonik", "Energy Drink": "Enerji içeceği",
  // bar
  "Rakı": "Rakı", Gin: "Cin", Vodka: "Votka", "White Rum": "Beyaz rom", Whisky: "Viski", "Red Wine": "Kırmızı şarap", "White Wine": "Beyaz şarap",
  "Draft Beer": "Fıçı bira", "Sugar Syrup": "Şeker şurubu",
  // kahve, çay
  "Espresso Beans": "Espresso çekirdeği", "Turkish Coffee": "Türk kahvesi", "Filter Coffee": "Filtre kahve", "Decaf Beans": "Kafeinsiz kahve çekirdeği",
  "Black Tea": "Siyah çay", "Green Tea Bags": "Yeşil çay (süzen poşet)", "Herbal Tea Bags": "Bitki çayı (süzen poşet)", "Earl Grey Bags": "Earl Grey çay (süzen poşet)",
  // pastane
  "Dark Chocolate": "Bitter çikolata", "White Chocolate": "Beyaz çikolata", "Cocoa Powder": "Kakao", "Vanilla Extract": "Vanilya özütü",
  "Pistachio Ground": "Toz Antep fıstığı", "Hazelnut Paste": "Fındık ezmesi", "Gelatin Leaves": "Yaprak jelatin", "Puff Pastry Sheet": "Milföy hamuru",
  "Phyllo Dough": "Baklavalık yufka", Ladyfingers: "Kedi dili",
  // kahvaltılık
  Honey: "Bal", "Strawberry Jam": "Çilek reçeli", "Black Olives": "Siyah zeytin", "Green Olives": "Yeşil zeytin", Tahini: "Tahin", Molasses: "Pekmez",
  "Croissant Frozen": "Dondurulmuş kruvasan", Simit: "Simit", "Corn Flakes": "Mısır gevreği", "Toast Bread": "Tost ekmeği",
  // temizlik
  "Floor Cleaner": "Yer temizleyici", "Glass Cleaner": "Cam temizleyici", "Microfiber Cloth": "Mikrofiber bez", "Garbage Bags": "Çöp poşeti",
  "Toilet Paper": "Tuvalet kâğıdı", "Paper Towels": "Kâğıt havlu", "Mop Head": "Paspas başlığı",
  // kimyasal
  "Dishwasher Detergent": "Bulaşık makinesi deterjanı", "Rinse Aid": "Parlatıcı", "Laundry Detergent": "Çamaşır deterjanı", "Fabric Softener": "Yumuşatıcı",
  Bleach: "Çamaşır suyu", Disinfectant: "Dezenfektan", "Pool Chlorine": "Havuz kloru",
  // ambalaj
  "Takeaway Box": "Paket servis kutusu", "Coffee Cup 8oz": "Karton kahve bardağı 8 oz", "Cup Lid": "Bardak kapağı", "Paper Bag": "Kâğıt poşet",
  Napkins: "Peçete", Straws: "Pipet", "Cling Film": "Streç film", "Aluminium Foil": "Alüminyum folyo",
  // buklet
  "Shampoo 30ml": "Şampuan 30 ml", "Shower Gel 30ml": "Duş jeli 30 ml", "Body Lotion 30ml": "Vücut losyonu 30 ml", "Soap Bar": "Kalıp sabun",
  "Dental Kit": "Diş bakım seti", Slippers: "Terlik", "Shower Cap": "Bone", "Sewing Kit": "Dikiş seti",
  // tekstil
  "Bed Sheet Double": "Çarşaf (çift kişilik)", "Bed Sheet Single": "Çarşaf (tek kişilik)", "Duvet Cover": "Nevresim", "Pillow Case": "Yastık kılıfı",
  "Bath Towel": "Banyo havlusu", "Hand Towel": "El havlusu", Bathrobe: "Bornoz", "Pool Towel": "Havuz havlusu",
  // teknik
  "LED Bulb E27": "LED ampul E27", "Fluorescent Tube": "Floresan tüp", "Silicone Sealant": "Silikon", "Paint White": "Beyaz boya", "Batteries AA": "AA pil",
  "Cable Ties": "Kablo bağı", "PVC Pipe": "PVC boru",
  // yedek parça
  "AC Filter": "Klima filtresi", "Fan Motor": "Fan motoru", "Water Pump Seal": "Su pompası keçesi", Thermostat: "Termostat",
  "Door Lock Battery": "Kapı kilidi pili", "Faucet Cartridge": "Batarya kartuşu", "Compressor Relay": "Kompresör rölesi",
  // QA kiracısındaki kasıtlı veri hataları
  "Saffron (no cost yet)": "Safran (maliyeti henüz yok)", "Frozen Fries (case size missing)": "Dondurulmuş patates (koli içeriği tanımsız)",
  "Truffle Oil (no supplier)": "Trüf yağı (tedarikçisi yok)",
};

/** catalogue categories by code */
export const CATEGORY_TR: Record<string, string> = {
  MEAT: "Et", CHICKEN: "Tavuk", FISH: "Balık", SEAFOOD: "Deniz ürünleri", VEG: "Sebze", FRUIT: "Meyve", DAIRY: "Süt ürünleri", CHEESE: "Peynir",
  DRY: "Kuru gıda", OIL: "Yağlar", SPICE: "Baharatlar", SAUCE: "Soslar", BEV: "Meşrubat", BAR: "Alkollü içkiler", COFFEE: "Kahve", TEA: "Çay",
  PASTRY: "Pastane malzemeleri", BRKF: "Kahvaltılık ürünler", CLEAN: "Temizlik malzemeleri", CHEM: "Kimyasallar", PACK: "Ambalaj malzemeleri",
  AMEN: "Buklet ürünleri", LINEN: "Yatak ve banyo tekstili", TECH: "Teknik malzeme", SPARE: "Yedek parça",
};

/** category groups (parent categories) by group code */
export const GROUP_TR: Record<string, string> = { FOOD: "Yiyecek", BEVERAGE: "İçecek", PACKAGING: "Ambalaj", HOUSEKEEPING: "Kat hizmetleri", ENGINEERING: "Teknik", LINEN: "Tekstil" };

/** departments (and their cost centers) by code */
export const DEPARTMENT_TR: Record<string, string> = {
  FO: "Ön Büro", ROOMS: "Odalar", HK: "Kat Hizmetleri", LAUN: "Çamaşırhane", FB: "Yiyecek & İçecek", REST: "Restoran", CAFE: "Kafe", BAR: "Bar",
  BRKF: "Kahvaltı", KITCH: "Mutfak", PAST: "Pastane", BANQ: "Banket", MINI: "Minibar", ENG: "Teknik Servis", FIN: "Muhasebe & Finans",
  HR: "İnsan Kaynakları", SM: "Satış & Pazarlama",
};

/** warehouses by code */
export const WAREHOUSE_TR: Record<string, string> = {
  MAIN: "Ana Depo", KITCH: "Mutfak Deposu", BAR: "Bar Deposu", BRKF: "Kahvaltı Deposu", BUFFET: "Kahvaltı Büfesi Deposu", PAST: "Pastane Deposu",
  HK: "Kat Hizmetleri Deposu", MINIBAR: "Minibar Deposu", MINIBAR_ROOMS: "Minibar (odada)", ENG: "Teknik Depo",
};

export const ROOM_TYPE_TR: Record<string, string> = { Standard: "Standart", Deluxe: "Deluxe", Family: "Aile", Suite: "Süit", Villa: "Villa" };

/** finished dishes (menu names) */
export const DISH_TR: Record<string, string> = {
  // restoran
  "Beef Tenderloin": "Dana Bonfile", "Lamb Chops": "Kuzu Pirzola", "Grilled Sea Bass": "Izgara Levrek", "Chicken Schnitzel": "Tavuk Şinitzel",
  "Salmon Steak": "Izgara Somon", "Köfte": "Izgara Köfte", "Mushroom Risotto": "Mantarlı Risotto", "Penne Arrabbiata": "Penne Arrabbiata",
  "Caesar Salad": "Sezar Salata", "Shrimp Casserole": "Karides Güveç", "Lamb Tandır": "Kuzu Tandır", "Beef Burger": "Dana Burger",
  "Chicken Burger": "Tavuk Burger", "Mediterranean Salad": "Akdeniz Salatası", "Lentil Soup": "Mercimek Çorbası", "Calamari Fritti": "Kalamar Tava",
  "Octopus Grill": "Izgara Ahtapot", "Veal Ossobuco": "Dana Ossobuco", "Eggplant Kebab": "Patlıcan Kebabı", "Club Sandwich": "Club Sandviç",
  // kafe
  Cappuccino: "Cappuccino", Latte: "Latte", Americano: "Americano", Espresso: "Espresso", "Turkish Coffee": "Türk Kahvesi",
  "Hot Chocolate": "Sıcak Çikolata", "Black Tea": "Demlik Çay", "Herbal Tea": "Bitki Çayı", Toast: "Kaşarlı Tost", "Croissant Sandwich": "Kruvasan Sandviç",
  "Avocado Toast": "Avokadolu Tost", "Fresh Orange Juice": "Taze Sıkma Portakal Suyu", Smoothie: "Smoothie", "Iced Latte": "Buzlu Latte",
  // bar
  "Gin Tonic": "Cin Tonik", Mojito: "Mojito", "Rakı Service": "Rakı Servisi", "Whisky Sour": "Whisky Sour", Margarita: "Margarita", Negroni: "Negroni",
  "Draft Beer": "Fıçı Bira", "House Red Wine": "Kırmızı Ev Şarabı", "House White Wine": "Beyaz Ev Şarabı", Cola: "Kola", "Lemon Soda": "Limonlu Soda",
  "Vodka Lemon": "Votka Limon", "Cuba Libre": "Cuba Libre", "Espresso Martini": "Espresso Martini",
  // kahvaltı
  Menemen: "Menemen", "Cheese Omelette": "Peynirli Omlet", "Sucuk with Eggs": "Sucuklu Yumurta", "Turkish Breakfast Plate": "Kahvaltı Tabağı",
  Pancakes: "Pankek", "Granola Bowl": "Granola Kasesi", "Poached Eggs": "Poşe Yumurta", "French Toast": "Yumurtalı Ekmek", "Simit Plate": "Simit Tabağı",
  "Fruit Plate": "Meyve Tabağı",
  // pastane
  Tiramisu: "Tiramisu", Cheesecake: "Cheesecake", "Chocolate Soufflé": "Çikolatalı Sufle", Baklava: "Baklava", "Künefe": "Künefe",
  Profiterole: "Profiterol", "Apple Pie": "Elmalı Turta", Kazandibi: "Kazandibi", "Fruit Tart": "Meyveli Tart", Brownie: "Brownie",
  "Macaron Box": "Makaron Kutusu", "Opera Cake": "Opera Pasta",
  // banket
  "Gala Dinner Menu": "Gala Yemeği Menüsü", "Coffee Break Set": "Kahve Molası Menüsü", "Cocktail Canapés": "Kokteyl Kanepeleri", "Wedding Menu": "Düğün Menüsü",
  "Business Lunch": "İş Yemeği Menüsü", "Meze Platter": "Meze Tabağı", "BBQ Night": "Mangal Gecesi", "Seafood Buffet": "Deniz Ürünleri Büfesi",
  // minibar
  "Minibar Cola": "Minibar Kola", "Minibar Water": "Minibar Su", "Minibar Chocolate": "Minibar Çikolata", "Minibar Nuts": "Minibar Kuruyemiş",
  "Minibar Beer": "Minibar Bira", "Minibar Juice": "Minibar Meyve Suyu", "Minibar Wine": "Minibar Şarap",
  // QA
  "Saffron Risotto (incomplete)": "Safranlı Risotto (eksik reçete)",
};

/** menu variants: Turkish puts most of them in front of the dish */
const STYLE_TR: Record<string, (dish: string) => string> = {
  "": (d) => d,
  " Classic": (d) => `Klasik ${d}`,
  " Signature": (d) => `Şefin Spesiyali ${d}`,
  " Light": (d) => `${d} (light)`,
  " Deluxe": (d) => `Deluxe ${d}`,
  " Chef's": (d) => `Şef Usulü ${d}`,
  " Large": (d) => `${d} (büyük)`,
  " Double": (d) => `Duble ${d}`,
  " Oat": (d) => `Yulaf Sütlü ${d}`,
  " Vanilla": (d) => `Vanilyalı ${d}`,
  " Premium": (d) => `Premium ${d}`,
  " Happy Hour": (d) => `${d} (Happy Hour)`,
  " Kids": (d) => `${d} (çocuk porsiyonu)`,
  " Vegetarian": (d) => `Vejetaryen ${d}`,
  " Slice": (d) => `${d} (dilim)`,
  " Mini": (d) => `Mini ${d}`,
  " Pistachio": (d) => `Fıstıklı ${d}`,
  " Standard": (d) => `${d} (standart)`,
};

export const SEMI_TR: Record<string, string> = {
  "Burger Sauce": "Burger Sosu", "Tomato Sauce": "Domates Sosu", "Pizza Dough": "Pizza Hamuru", "Cake Cream": "Pasta Kreması",
  "Chocolate Ganache": "Çikolatalı Ganaj", "Soup Base": "Çorba Esası", "Special Mix": "Özel Karışım", "Spice Mix": "Baharat Karışımı",
  "Béchamel": "Beşamel Sos", "Demi-glace": "Demi-glace Sos", Pesto: "Pesto Sos", "Caramel Sauce": "Karamel Sos", "Vanilla Custard": "Vanilyalı Muhallebi",
  "Garlic Butter": "Sarımsaklı Tereyağı", Marinade: "Et Marinasyonu", Vinaigrette: "Vinegret Sos", "Pastry Cream": "Pastacı Kreması",
  Shortcrust: "Tart Hamuru", "Simple Syrup": "Şeker Şurubu", "Pickled Onions": "Soğan Turşusu",
};

export const POSITION_TR: Record<string, string> = {
  Receptionist: "Resepsiyonist", "Night Auditor": "Gece Denetçisi", Concierge: "Konsiyerj", "Guest Relations": "Misafir İlişkileri",
  "Room Attendant": "Oda Görevlisi", "Floor Supervisor": "Kat Şefi", "Public Area Cleaner": "Genel Alan Görevlisi",
  "Laundry Attendant": "Çamaşırhane Görevlisi", Presser: "Ütücü", Waiter: "Garson", "Head Waiter": "Şef Garson", Busser: "Komi",
  Barista: "Barista", "Cafe Attendant": "Kafe Görevlisi", Bartender: "Barmen", "Bar Back": "Bar Komisi", "Breakfast Cook": "Kahvaltı Aşçısı",
  "Breakfast Waiter": "Kahvaltı Garsonu", "Commis Chef": "Aşçı Yardımcısı", "Chef de Partie": "Bölüm Şefi", "Sous Chef": "Sous Chef",
  Steward: "Bulaşıkhane Görevlisi", "Pastry Cook": "Pastacı", "Pastry Chef": "Pastane Şefi", "Banquet Waiter": "Banket Garsonu",
  "Banquet Captain": "Banket Kaptanı", Technician: "Teknisyen", Electrician: "Elektrikçi", Plumber: "Tesisatçı", Accountant: "Muhasebeci",
  "Cost Controller": "Maliyet Kontrolörü", Purchaser: "Satın Alma Uzmanı", "HR Specialist": "İK Uzmanı", Trainer: "Eğitmen",
  "Sales Executive": "Satış Yöneticisi", "Revenue Manager": "Gelir Müdürü", "Rooms Division Manager": "Odalar Bölümü Müdürü",
  "F&B Manager": "Yiyecek & İçecek Müdürü", "Minibar Attendant": "Minibar Görevlisi", Staff: "Personel",
  // demo user titles
  "Executive Chef": "Mutfak Şefi", "Breakfast Chef": "Kahvaltı Şefi", "Purchasing Manager": "Satın Alma Müdürü", "Accounting Manager": "Muhasebe Müdürü",
  Storekeeper: "Depo Sorumlusu", Viewer: "İzleyici",
};

export const ORG_TR: Record<string, string> = {
  "Demo Hotel Group": "Demo Otel Grubu", "Demo Resort Group": "Demo Tatil Köyü Grubu", "Demo City Hotel": "Demo Şehir Oteli",
  "Demo Boutique Hotel": "Demo Butik Otel", "Demo All Inclusive": "Demo Her Şey Dahil", "Demo Tiny Group": "Demo Mini Grup", "Demo Tiny QA": "Demo Mini QA",
};

export const HOTEL_TR: Record<string, string> = {
  "Demo All Inclusive Belek": "Demo Her Şey Dahil Belek", "Demo Boutique Kapadokya": "Demo Butik Kapadokya", "Demo Boutique Alaçatı": "Demo Butik Alaçatı",
};

/** fixed texts written by the generator (ledger reasons, notes, expenses, assets, meters, rules, savings...) */
export const TEXT_TR: Record<string, string> = {
  // rooms
  Villas: "Villalar", "Main building": "Ana bina",
  // supplier word
  Bosphorus: "Boğaziçi",
  // recipe versions
  "Standard batch": "Standart parti", "Initial standard": "İlk standart", "Portion adjusted after tasting": "Tadım sonrası porsiyon ayarlandı",
  "Supplier change, recipe re-engineered": "Tedarikçi değişti, reçete yeniden düzenlendi",
  // waste reasons
  "Spoiled in storage": "Depoda bozuldu", "Past expiry date": "Son kullanma tarihi geçti", "Preparation loss": "Hazırlık firesi",
  "Trimming above standard": "Standardın üstünde ayıklama firesi", "Burned on grill": "Izgarada yandı", "Overcooked, not served": "Fazla pişti, servis edilmedi",
  "Dropped during service": "Servis sırasında düştü", "Returned plate waste": "Tabakta geri dönen artık", "Guest complaint, returned": "Misafir şikâyeti, iade edildi",
  "Rejected at quality check": "Kalite kontrolde reddedildi", "Over-produced for service": "Servis için fazla üretildi", "Temperature loss": "Sıcaklık kaybı",
  "Cold chain break": "Soğuk zincir kırıldı",
  // stock movements
  "Opening balance (go-live)": "Açılış bakiyesi (canlıya geçiş)", "Kitchen issue (lunch shift)": "Mutfak çıkışı (öğle vardiyası)",
  "Kitchen issue (dinner shift)": "Mutfak çıkışı (akşam vardiyası)", "Daily housekeeping issue": "Günlük kat hizmetleri çıkışı",
  "Maintenance job": "Bakım işi", "Staff canteen": "Personel yemekhanesi", "VIP welcome": "VIP karşılama", "Month-end count": "Ay sonu sayımı",
  "Issued before the delivery note was booked": "İrsaliye kaydedilmeden çıkış yapıldı",
  "Historical month closed by the demo generator": "Geçmiş ay, demo veri üreticisi tarafından kapatıldı",
  // assets
  "Central chiller 1": "Merkezi soğutma grubu 1", "Combi oven": "Kombi fırın", "Flight dishwasher": "Konveyörlü bulaşık makinesi", "Cold room": "Soğuk oda",
  "Washer extractor": "Çamaşır makinesi", "Guest elevator": "Misafir asansörü", "Pool filtration": "Havuz filtrasyonu",
  // meters
  "Electricity rooms": "Elektrik - odalar", "Electricity kitchen": "Elektrik - mutfak", "Electricity laundry": "Elektrik - çamaşırhane",
  "Electricity restaurant": "Elektrik - restoran", "Water rooms": "Su - odalar", "Water laundry": "Su - çamaşırhane", "Water kitchen": "Su - mutfak",
  "Gas kitchen": "Doğalgaz - mutfak", "Gas laundry": "Doğalgaz - çamaşırhane",
  // allocation rules
  "Electricity by sub-meter": "Elektrik (alt sayaç)", "Water by sub-meter": "Su (alt sayaç)", "Natural gas by sub-meter": "Doğalgaz (alt sayaç)",
  "Engineering department by m²": "Teknik servis giderleri (m² bazında)",
  // expenses
  Payroll: "Maaş", "SGK employer share": "SGK işveren payı", Overtime: "Fazla mesai", Electricity: "Elektrik", Water: "Su", "Natural gas": "Doğalgaz",
  LPG: "LPG", "Generator diesel": "Jeneratör motorini", "Facade & window cleaning contract": "Cephe ve cam temizliği sözleşmesi",
  "Laundry chemicals contract": "Çamaşırhane kimyasal sözleşmesi", "PMS / POS licences": "PMS / POS lisansları", "External audit fee": "Bağımsız denetim ücreti",
  "Online advertising": "Online reklam", "Elevator maintenance contract": "Asansör bakım sözleşmesi", "Land lease": "Arazi kirası",
  "Property insurance": "Bina sigortası", Depreciation: "Amortisman", Room: "Oda", "AC failure": "klima arızası", "water leak": "su kaçağı",
  "Local market purchase": "Semt pazarı alımı", "Small spare parts": "Küçük yedek parçalar", "Housekeeping small supplies": "Kat hizmetleri küçük malzeme",
  "Front office supplies": "Ön büro sarf malzemesi", "Printed material": "Basılı materyal", "Bank & POS charges": "Banka ve POS masrafları",
  "Staff training": "Personel eğitimi", "Dry cleaning (guest)": "Kuru temizleme (misafir)",
  // budget
  "F&B cost budget set 18 % below run rate (scenario 13: overrun)": "Y&İ maliyet bütçesi mevcut gidişatın %18 altında belirlendi (senaryo 13: aşım)",
  "Seasonality-weighted run rate, 3 % efficiency": "Sezonsallık ağırlıklı mevcut gidişat, %3 verimlilik",
  // saving actions
  "Buffet leftovers above 10 % on low-occupancy days": "Düşük doluluklu günlerde büfe artığı %10'un üzerinde",
  "Production not linked to expected covers": "Üretim, beklenen kişi sayısına göre planlanmıyor",
  "Cook in waves from the cover forecast; smaller refill trays": "Kişi tahminine göre partiler halinde pişirme; daha küçük takviye tepsileri",
  "Protein prices up 15-30 % at the main supplier": "Ana tedarikçide protein fiyatları %15-30 arttı",
  "Single-source contract": "Tek tedarikçili sözleşme", "Tender with two alternative suppliers": "İki alternatif tedarikçiyle ihale",
};

export interface DemoNames {
  locale: DemoLocale;
  /** generic fixed text */
  t: (en: string) => string;
  product: (en: string) => string;
  category: (code: string, en: string) => string;
  group: (code: string, en: string) => string;
  dept: (code: string, en: string) => string;
  warehouse: (code: string, en: string) => string;
  roomType: (en: string) => string;
  dish: (main: string, style: string) => string;
  semi: (en: string) => string;
  position: (en: string) => string;
  org: (en: string) => string;
  hotel: (en: string) => string;
}

export function demoNames(locale: DemoLocale = "en"): DemoNames {
  const pick = (map: Record<string, string>, key: string, en: string) => (locale === "tr" ? (map[key] ?? en) : en);
  return {
    locale,
    t: (en) => pick(TEXT_TR, en, en),
    product: (en) => pick(PRODUCT_TR, en, en),
    category: (code, en) => pick(CATEGORY_TR, code, en),
    group: (code, en) => pick(GROUP_TR, code, en),
    dept: (code, en) => pick(DEPARTMENT_TR, code, en),
    warehouse: (code, en) => pick(WAREHOUSE_TR, code, en),
    roomType: (en) => pick(ROOM_TYPE_TR, en, en),
    dish: (main, style) => (locale === "tr" ? (STYLE_TR[style] ?? ((d: string) => `${d}${style}`))(DISH_TR[main] ?? main) : `${main}${style}`),
    semi: (en) => pick(SEMI_TR, en, en),
    position: (en) => pick(POSITION_TR, en, en),
    org: (en) => pick(ORG_TR, en, en),
    hotel: (en) => pick(HOTEL_TR, en, en),
  };
}
