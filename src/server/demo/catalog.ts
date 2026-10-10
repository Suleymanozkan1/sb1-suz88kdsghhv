/**
 * Realistic master data for demo tenants (spec 41–47). Prices are TRY per stock unit, early-2026 levels.
 * Item tuple: [name, stockUnit, purchaseUnit | null, unitsPerPurchaseUnit | null, price, yieldPct]
 */
export type CatalogItem = [string, "kg" | "l" | "pc", "case" | "pack" | "box" | "bottle" | "tray" | "bag" | "can" | null, number | null, number, number];

export interface CatalogCategory {
  code: string;
  name: string;
  group: "FOOD" | "BEVERAGE" | "PACKAGING" | "HOUSEKEEPING" | "ENGINEERING" | "LINEN";
  items: CatalogItem[];
}

export const CATALOG: CatalogCategory[] = [
  { code: "MEAT", name: "Et / Meat", group: "FOOD", items: [["Beef Tenderloin", "kg", null, null, 1450, 88], ["Beef Ribeye", "kg", null, null, 1180, 90], ["Ground Beef", "kg", null, null, 620, 97], ["Lamb Leg", "kg", null, null, 780, 72], ["Lamb Chops", "kg", null, null, 980, 85], ["Veal Shank", "kg", null, null, 690, 70], ["Beef Brisket", "kg", null, null, 560, 80], ["Sucuk", "kg", "pack", 0.5, 640, 100], ["Pastırma", "kg", "pack", 0.25, 1800, 100], ["Lamb Shoulder", "kg", null, null, 720, 75]] },
  { code: "CHICKEN", name: "Tavuk / Poultry", group: "FOOD", items: [["Chicken Breast", "kg", "case", 10, 190, 92], ["Chicken Thigh", "kg", "case", 10, 165, 85], ["Whole Chicken", "kg", null, null, 120, 68], ["Chicken Wings", "kg", "case", 5, 140, 95], ["Turkey Breast", "kg", null, null, 310, 90], ["Chicken Liver", "kg", null, null, 95, 95], ["Chicken Drumstick", "kg", "case", 10, 130, 80], ["Smoked Turkey", "kg", "pack", 1, 420, 100]] },
  { code: "FISH", name: "Balık / Fish", group: "FOOD", items: [["Salmon Fillet", "kg", null, null, 980, 92], ["Sea Bass", "kg", null, null, 520, 55], ["Sea Bream", "kg", null, null, 480, 55], ["Turbot", "kg", null, null, 1100, 50], ["Anchovy", "kg", null, null, 180, 60], ["Tuna Loin", "kg", null, null, 1250, 90], ["Smoked Salmon", "kg", "pack", 0.5, 1650, 100], ["Cod Fillet", "kg", null, null, 640, 95]] },
  { code: "SEAFOOD", name: "Deniz ürünleri / Seafood", group: "FOOD", items: [["Shrimp", "kg", "box", 2, 720, 60], ["Calamari", "kg", null, null, 460, 75], ["Mussels", "kg", null, null, 210, 40], ["Octopus", "kg", null, null, 890, 65], ["King Prawns", "kg", "box", 1, 1250, 62], ["Scallops", "kg", "box", 1, 1900, 95]] },
  { code: "VEG", name: "Sebze / Vegetables", group: "FOOD", items: [["Tomato", "kg", "case", 6, 32, 93], ["Cucumber", "kg", "case", 6, 26, 95], ["Lettuce Iceberg", "kg", "case", 5, 38, 80], ["Onion", "kg", "bag", 10, 18, 90], ["Garlic", "kg", null, null, 140, 85], ["Potato", "kg", "bag", 25, 16, 82], ["Carrot", "kg", "bag", 10, 20, 85], ["Bell Pepper", "kg", "case", 5, 55, 85], ["Eggplant", "kg", "case", 6, 34, 80], ["Zucchini", "kg", "case", 6, 30, 90], ["Mushroom", "kg", "box", 2, 120, 95], ["Spinach", "kg", "case", 3, 60, 75], ["Rocket", "kg", "box", 1, 180, 85], ["Parsley", "kg", null, null, 90, 70], ["Fresh Mint", "kg", null, null, 160, 60]] },
  { code: "FRUIT", name: "Meyve / Fruits", group: "FOOD", items: [["Lemon", "kg", "case", 10, 35, 95], ["Lime", "kg", "box", 4, 120, 95], ["Orange", "kg", "case", 15, 28, 70], ["Apple", "kg", "case", 15, 35, 85], ["Banana", "kg", "box", 18, 48, 70], ["Strawberry", "kg", "tray", 2, 140, 90], ["Watermelon", "kg", null, null, 12, 55], ["Grapes", "kg", "box", 5, 70, 92], ["Pineapple", "pc", null, null, 95, 60], ["Avocado", "pc", "box", 20, 38, 70]] },
  { code: "DAIRY", name: "Süt ürünleri / Dairy", group: "FOOD", items: [["Whole Milk", "l", "case", 12, 32, 100], ["Cooking Cream", "l", "case", 12, 120, 100], ["Butter", "kg", "box", 10, 420, 100], ["Yoghurt", "kg", "box", 9, 75, 100], ["Ayran", "pc", "case", 20, 9, 100], ["Kaymak", "kg", null, null, 520, 100], ["Whipping Cream", "l", "case", 12, 150, 100], ["Eggs", "pc", "tray", 30, 4.2, 100]] },
  { code: "CHEESE", name: "Peynir / Cheese", group: "FOOD", items: [["White Cheese", "kg", "box", 5, 260, 100], ["Kaşar", "kg", "box", 5, 380, 100], ["Cheddar", "kg", "box", 5, 420, 100], ["Mozzarella", "kg", "box", 2, 360, 100], ["Parmesan", "kg", null, null, 1200, 95], ["Mascarpone", "kg", "box", 2, 480, 100], ["Tulum Cheese", "kg", null, null, 520, 100], ["Labneh", "kg", "box", 3, 210, 100]] },
  { code: "DRY", name: "Kuru gıda / Dry goods", group: "FOOD", items: [["Rice Baldo", "kg", "bag", 5, 70, 100], ["Bulgur", "kg", "bag", 5, 38, 100], ["Pasta Penne", "kg", "case", 6, 42, 100], ["Spaghetti", "kg", "case", 6, 40, 100], ["Flour", "kg", "bag", 25, 22, 100], ["Sugar", "kg", "bag", 25, 34, 100], ["Red Lentils", "kg", "bag", 5, 55, 100], ["Chickpeas", "kg", "bag", 5, 62, 100], ["Breadcrumbs", "kg", "pack", 1, 60, 100], ["Oats", "kg", "pack", 1, 85, 100]] },
  { code: "OIL", name: "Yağ / Oils", group: "FOOD", items: [["Sunflower Oil", "l", "can", 18, 62, 100], ["Olive Oil Extra Virgin", "l", "can", 5, 380, 100], ["Frying Oil", "l", "can", 18, 70, 100], ["Margarine", "kg", "box", 10, 95, 100]] },
  { code: "SPICE", name: "Baharat / Spices", group: "FOOD", items: [["Salt", "kg", "bag", 10, 12, 100], ["Black Pepper", "kg", "pack", 1, 520, 100], ["Red Pepper Flakes", "kg", "pack", 1, 340, 100], ["Cumin", "kg", "pack", 1, 410, 100], ["Oregano", "kg", "pack", 0.5, 380, 100], ["Sumac", "kg", "pack", 1, 290, 100], ["Paprika", "kg", "pack", 1, 310, 100], ["Cinnamon", "kg", "pack", 0.5, 460, 100], ["Thyme", "kg", "pack", 0.5, 420, 100]] },
  { code: "SAUCE", name: "Sos / Sauces", group: "FOOD", items: [["Ketchup", "kg", "case", 6, 85, 100], ["Mayonnaise", "kg", "case", 6, 110, 100], ["Mustard", "kg", "case", 6, 120, 100], ["Tomato Paste", "kg", "can", 4.3, 75, 100], ["Pepper Paste", "kg", "can", 4.3, 95, 100], ["Soy Sauce", "l", "bottle", 1, 160, 100], ["Pomegranate Molasses", "l", "bottle", 1, 210, 100], ["Balsamic Vinegar", "l", "bottle", 0.5, 340, 100]] },
  { code: "BEV", name: "İçecek / Soft drinks", group: "BEVERAGE", items: [["Cola 330ml", "pc", "case", 24, 18, 100], ["Diet Cola 330ml", "pc", "case", 24, 18, 100], ["Lemon Soda", "pc", "case", 24, 12, 100], ["Still Water 500ml", "pc", "case", 24, 5, 100], ["Sparkling Water", "pc", "case", 24, 9, 100], ["Orange Juice", "l", "case", 12, 70, 100], ["Tonic Water", "pc", "case", 24, 22, 100], ["Energy Drink", "pc", "case", 24, 42, 100]] },
  { code: "BAR", name: "Bar / Spirits & wine", group: "BEVERAGE", items: [["Rakı", "l", "bottle", 0.7, 1170, 100], ["Gin", "l", "bottle", 0.7, 1780, 100], ["Vodka", "l", "bottle", 0.7, 1570, 100], ["White Rum", "l", "bottle", 0.7, 1500, 100], ["Whisky", "l", "bottle", 0.7, 2350, 100], ["Red Wine", "l", "bottle", 0.75, 640, 100], ["White Wine", "l", "bottle", 0.75, 600, 100], ["Draft Beer", "l", null, null, 95, 97], ["Sugar Syrup", "l", "bottle", 1, 90, 100]] },
  { code: "COFFEE", name: "Kahve / Coffee", group: "BEVERAGE", items: [["Espresso Beans", "kg", "bag", 1, 980, 100], ["Turkish Coffee", "kg", "pack", 1, 760, 100], ["Filter Coffee", "kg", "bag", 1, 690, 100], ["Decaf Beans", "kg", "bag", 1, 1100, 100]] },
  { code: "TEA", name: "Çay / Tea", group: "BEVERAGE", items: [["Black Tea", "kg", "pack", 1, 420, 100], ["Green Tea Bags", "pc", "box", 100, 2.2, 100], ["Herbal Tea Bags", "pc", "box", 100, 2.6, 100], ["Earl Grey Bags", "pc", "box", 100, 2.4, 100]] },
  { code: "PASTRY", name: "Pastane / Pastry materials", group: "FOOD", items: [["Dark Chocolate", "kg", "box", 5, 640, 100], ["White Chocolate", "kg", "box", 5, 690, 100], ["Cocoa Powder", "kg", "pack", 1, 520, 100], ["Vanilla Extract", "l", "bottle", 0.5, 1900, 100], ["Pistachio Ground", "kg", "pack", 1, 1450, 100], ["Hazelnut Paste", "kg", "box", 5, 720, 100], ["Gelatin Leaves", "kg", "pack", 0.5, 980, 100], ["Puff Pastry Sheet", "kg", "box", 10, 110, 100], ["Phyllo Dough", "kg", "box", 5, 95, 100], ["Ladyfingers", "kg", "box", 2, 260, 100]] },
  { code: "BRKF", name: "Kahvaltı / Breakfast", group: "FOOD", items: [["Honey", "kg", "can", 5, 420, 100], ["Strawberry Jam", "kg", "can", 5, 160, 100], ["Black Olives", "kg", "can", 5, 180, 100], ["Green Olives", "kg", "can", 5, 170, 100], ["Tahini", "kg", "can", 5, 260, 100], ["Molasses", "kg", "can", 5, 190, 100], ["Croissant Frozen", "pc", "box", 60, 14, 100], ["Simit", "pc", null, null, 10, 100], ["Corn Flakes", "kg", "box", 5, 140, 100], ["Toast Bread", "pc", "pack", 1, 38, 100]] },
  { code: "CLEAN", name: "Temizlik / Cleaning supplies", group: "HOUSEKEEPING", items: [["Floor Cleaner", "l", "can", 5, 65, 100], ["Glass Cleaner", "l", "can", 5, 70, 100], ["Microfiber Cloth", "pc", "pack", 10, 25, 100], ["Garbage Bags", "pc", "pack", 50, 3.5, 100], ["Toilet Paper", "pc", "pack", 32, 6, 100], ["Paper Towels", "pc", "pack", 12, 14, 100], ["Mop Head", "pc", null, null, 120, 100]] },
  { code: "CHEM", name: "Kimyasal / Chemicals", group: "HOUSEKEEPING", items: [["Dishwasher Detergent", "l", "can", 20, 75, 100], ["Rinse Aid", "l", "can", 20, 95, 100], ["Laundry Detergent", "kg", "bag", 20, 68, 100], ["Fabric Softener", "l", "can", 20, 48, 100], ["Bleach", "l", "can", 20, 22, 100], ["Disinfectant", "l", "can", 5, 140, 100], ["Pool Chlorine", "kg", "bag", 25, 85, 100]] },
  { code: "PACK", name: "Ambalaj / Packaging", group: "PACKAGING", items: [["Takeaway Box", "pc", "case", 200, 4.5, 100], ["Coffee Cup 8oz", "pc", "case", 1000, 1.6, 100], ["Cup Lid", "pc", "case", 1000, 0.7, 100], ["Paper Bag", "pc", "pack", 100, 2.2, 100], ["Napkins", "pc", "pack", 500, 0.25, 100], ["Straws", "pc", "box", 500, 0.3, 100], ["Cling Film", "pc", null, null, 220, 100], ["Aluminium Foil", "pc", null, null, 260, 100]] },
  { code: "AMEN", name: "Amenity", group: "HOUSEKEEPING", items: [["Shampoo 30ml", "pc", "case", 300, 6.5, 100], ["Shower Gel 30ml", "pc", "case", 300, 6.2, 100], ["Body Lotion 30ml", "pc", "case", 300, 7.1, 100], ["Soap Bar", "pc", "case", 500, 3.8, 100], ["Dental Kit", "pc", "case", 500, 5.5, 100], ["Slippers", "pc", "case", 100, 18, 100], ["Shower Cap", "pc", "case", 500, 1.9, 100], ["Sewing Kit", "pc", "case", 500, 2.4, 100]] },
  { code: "LINEN", name: "Linen", group: "LINEN", items: [["Bed Sheet Double", "pc", null, null, 640, 100], ["Bed Sheet Single", "pc", null, null, 480, 100], ["Duvet Cover", "pc", null, null, 820, 100], ["Pillow Case", "pc", null, null, 160, 100], ["Bath Towel", "pc", null, null, 340, 100], ["Hand Towel", "pc", null, null, 140, 100], ["Bathrobe", "pc", null, null, 1100, 100], ["Pool Towel", "pc", null, null, 380, 100]] },
  { code: "TECH", name: "Teknik malzeme / Technical supplies", group: "ENGINEERING", items: [["LED Bulb E27", "pc", "box", 10, 85, 100], ["Fluorescent Tube", "pc", "box", 25, 70, 100], ["Silicone Sealant", "pc", "box", 12, 140, 100], ["Paint White", "l", "can", 15, 160, 100], ["Batteries AA", "pc", "pack", 40, 18, 100], ["Cable Ties", "pc", "pack", 100, 1.2, 100], ["PVC Pipe", "pc", null, null, 120, 100]] },
  { code: "SPARE", name: "Yedek parça / Spare parts", group: "ENGINEERING", items: [["AC Filter", "pc", null, null, 450, 100], ["Fan Motor", "pc", null, null, 2600, 100], ["Water Pump Seal", "pc", null, null, 680, 100], ["Thermostat", "pc", null, null, 1150, 100], ["Door Lock Battery", "pc", "pack", 10, 45, 100], ["Faucet Cartridge", "pc", null, null, 520, 100], ["Compressor Relay", "pc", null, null, 890, 100]] },
];

export const DEMO_DEPARTMENTS: Array<{ code: string; name: string; outlet: boolean; parent: string | null; recipeType?: string; warehouse?: string }> = [
  { code: "FO", name: "Front Office", outlet: false, parent: "ROOMS" },
  { code: "ROOMS", name: "Rooms", outlet: false, parent: null },
  { code: "HK", name: "Housekeeping", outlet: false, parent: "ROOMS", warehouse: "HK" },
  { code: "LAUN", name: "Laundry", outlet: false, parent: "ROOMS" },
  { code: "FB", name: "Food & Beverage", outlet: false, parent: null },
  { code: "REST", name: "Restaurant", outlet: true, parent: "FB", recipeType: "RESTAURANT", warehouse: "KITCH" },
  { code: "CAFE", name: "Cafe", outlet: true, parent: "FB", recipeType: "CAFE", warehouse: "KITCH" },
  { code: "BAR", name: "Bar", outlet: true, parent: "FB", recipeType: "BAR", warehouse: "BAR" },
  // breakfast is issued from the kitchen store: there is no breakfast (buffet) store
  { code: "BRKF", name: "Breakfast", outlet: true, parent: "FB", recipeType: "BREAKFAST", warehouse: "KITCH" },
  { code: "KITCH", name: "Kitchen", outlet: false, parent: "FB", warehouse: "KITCH" },
  { code: "PAST", name: "Pastry", outlet: true, parent: "FB", recipeType: "PASTRY", warehouse: "PAST" },
  { code: "BANQ", name: "Banquet", outlet: true, parent: "FB", recipeType: "BANQUET", warehouse: "KITCH" },
  { code: "MINI", name: "Minibar", outlet: true, parent: "ROOMS" },
  { code: "ENG", name: "Engineering", outlet: false, parent: null, warehouse: "ENG" },
  { code: "FIN", name: "Finance", outlet: false, parent: null },
  { code: "HR", name: "Human Resources", outlet: false, parent: null },
  { code: "SM", name: "Sales & Marketing", outlet: false, parent: null },
];

export const DEMO_WAREHOUSES: Array<[string, string, string | null]> = [
  ["MAIN", "Main Warehouse", null],
  ["KITCH", "Kitchen Warehouse", "KITCH"],
  ["BAR", "Bar Warehouse", "BAR"],
  ["PAST", "Pastry Warehouse", "PAST"],
  ["HK", "Housekeeping Warehouse", "HK"],
  ["MINIBAR", "Minibar Warehouse", "MINI"],
  ["MINIBAR_ROOMS", "Minibar In-Room", "MINI"],
  ["ENG", "Engineering Warehouse", "ENG"],
];

export const ROOM_TYPES: Array<{ type: string; share: number; sqm: number; rate: number }> = [
  { type: "Standard", share: 0.5, sqm: 26, rate: 3800 },
  { type: "Deluxe", share: 0.25, sqm: 34, rate: 5200 },
  { type: "Family", share: 0.12, sqm: 45, rate: 6800 },
  { type: "Suite", share: 0.1, sqm: 60, rate: 9500 },
  { type: "Villa", share: 0.03, sqm: 140, rate: 24000 },
];

export const DISH_WORDS: Record<string, { mains: string[]; styles: string[] }> = {
  RESTAURANT: { mains: ["Beef Tenderloin", "Lamb Chops", "Grilled Sea Bass", "Chicken Schnitzel", "Salmon Steak", "Köfte", "Mushroom Risotto", "Penne Arrabbiata", "Caesar Salad", "Shrimp Casserole", "Lamb Tandır", "Beef Burger", "Chicken Burger", "Mediterranean Salad", "Lentil Soup", "Calamari Fritti", "Octopus Grill", "Veal Ossobuco", "Eggplant Kebab", "Club Sandwich"], styles: ["", " Classic", " Signature", " Light", " Deluxe", " Chef's"] },
  CAFE: { mains: ["Cappuccino", "Latte", "Americano", "Espresso", "Turkish Coffee", "Hot Chocolate", "Black Tea", "Herbal Tea", "Toast", "Croissant Sandwich", "Avocado Toast", "Fresh Orange Juice", "Smoothie", "Iced Latte"], styles: ["", " Large", " Double", " Oat", " Vanilla"] },
  BAR: { mains: ["Gin Tonic", "Mojito", "Rakı Service", "Whisky Sour", "Margarita", "Negroni", "Draft Beer", "House Red Wine", "House White Wine", "Cola", "Lemon Soda", "Vodka Lemon", "Cuba Libre", "Espresso Martini"], styles: ["", " Double", " Premium", " Happy Hour"] },
  BREAKFAST: { mains: ["Menemen", "Cheese Omelette", "Sucuk with Eggs", "Turkish Breakfast Plate", "Pancakes", "Granola Bowl", "Poached Eggs", "French Toast", "Simit Plate", "Fruit Plate"], styles: ["", " Large", " Kids", " Vegetarian"] },
  PASTRY: { mains: ["Tiramisu", "Cheesecake", "Chocolate Soufflé", "Baklava", "Künefe", "Profiterole", "Apple Pie", "Kazandibi", "Fruit Tart", "Brownie", "Macaron Box", "Opera Cake"], styles: ["", " Slice", " Mini", " Pistachio"] },
  BANQUET: { mains: ["Gala Dinner Menu", "Coffee Break Set", "Cocktail Canapés", "Wedding Menu", "Business Lunch", "Meze Platter", "BBQ Night", "Seafood Buffet"], styles: ["", " Premium", " Standard"] },
  MINIBAR: { mains: ["Minibar Cola", "Minibar Water", "Minibar Chocolate", "Minibar Nuts", "Minibar Beer", "Minibar Juice", "Minibar Wine"], styles: [""] },
};

export const SEMI_FINISHED: string[] = ["Burger Sauce", "Tomato Sauce", "Pizza Dough", "Cake Cream", "Chocolate Ganache", "Soup Base", "Special Mix", "Spice Mix", "Béchamel", "Demi-glace", "Pesto", "Caramel Sauce", "Vanilla Custard", "Garlic Butter", "Marinade", "Vinaigrette", "Pastry Cream", "Shortcrust", "Simple Syrup", "Pickled Onions"];

export const POSITIONS: Record<string, string[]> = {
  FO: ["Receptionist", "Night Auditor", "Concierge", "Guest Relations"],
  HK: ["Room Attendant", "Floor Supervisor", "Public Area Cleaner"],
  LAUN: ["Laundry Attendant", "Presser"],
  REST: ["Waiter", "Head Waiter", "Busser"],
  CAFE: ["Barista", "Cafe Attendant"],
  BAR: ["Bartender", "Bar Back"],
  BRKF: ["Breakfast Cook", "Breakfast Waiter"],
  KITCH: ["Commis Chef", "Chef de Partie", "Sous Chef", "Steward"],
  PAST: ["Pastry Cook", "Pastry Chef"],
  BANQ: ["Banquet Waiter", "Banquet Captain"],
  ENG: ["Technician", "Electrician", "Plumber"],
  FIN: ["Accountant", "Cost Controller", "Purchaser"],
  HR: ["HR Specialist", "Trainer"],
  SM: ["Sales Executive", "Revenue Manager"],
  ROOMS: ["Rooms Division Manager"],
  FB: ["F&B Manager"],
  MINI: ["Minibar Attendant"],
};

export const FIRST_NAMES = ["Ahmet", "Mehmet", "Ayşe", "Fatma", "Mustafa", "Emine", "Ali", "Zeynep", "Hüseyin", "Elif", "Murat", "Selin", "Can", "Deniz", "Burak", "Ece", "Emre", "Gizem", "Kerem", "Merve", "Oğuz", "Pınar", "Serkan", "Tuğba", "Volkan", "Yasemin", "Barış", "Cem", "Derya", "Esra"];
export const LAST_NAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Koç", "Kurt", "Özdemir", "Polat", "Erdoğan", "Güneş", "Tekin"];
export const SUPPLIER_WORDS = ["Anadolu", "Ege", "Akdeniz", "Marmara", "Karadeniz", "Toros", "Bosphorus", "Kapadokya", "Pamukkale", "Trakya", "Antalya", "İzmir", "Bursa", "Konya", "Mersin", "Datça", "Bodrum", "Göreme", "Uludağ", "Kaçkar"];
export const SUPPLIER_KINDS = ["Et Gıda", "Su Ürünleri", "Sebze Meyve Hal", "Süt Ürünleri", "Kuru Gıda Toptan", "İçecek Dağıtım", "Temizlik Kimya", "Ambalaj", "Otel Ekipmanları", "Teknik Malzeme"];
