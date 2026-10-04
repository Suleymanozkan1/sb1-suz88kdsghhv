/** Demo dataset sizes (spec 126–127). `staging` is the large realistic dataset; `dev` fits a laptop; `tiny` is for tests. */
export interface DemoProfile {
  name: "tiny" | "dev" | "staging";
  /** full months of history before the current month */
  months: number;
  /** organizations and hotels per organization */
  orgs: Array<{ key: string; name: string; slug: string; hotels: Array<{ code: string; name: string; city: string; resort: boolean; rooms: number }>; extraUsers: number }>;
  productsPerHotel: number;
  recipes: { finished: number; semi: number; versioned: number };
  /** POS lines per recipe sold per day (time-slot split) */
  posSlots: number;
  /** kitchen issues per day (store top-up + consumption posting), e.g. morning and afternoon */
  issueSlots: number;
  /** fresh goods (produce, meat, fish, dairy) bought by weight every day instead of whole cases */
  freshByWeight: boolean;
  wastePerDay: number;
  buffetSessions: number;
  minibarRoomsPerDay: number;
  employeesPerHotel: number;
  dailyExpenses: number;
}

const ORGS_FULL: DemoProfile["orgs"] = [
  { key: "A", name: "Demo Hotel Group", slug: "demo-hotel-group", extraUsers: 100, hotels: [
    { code: "DHG-IST", name: "Demo Grand İstanbul", city: "İstanbul", resort: false, rooms: 140 },
    { code: "DHG-AYT", name: "Demo Lara Antalya", city: "Antalya", resort: true, rooms: 120 },
    { code: "DHG-IZM", name: "Demo Kordon İzmir", city: "İzmir", resort: false, rooms: 90 },
  ] },
  { key: "B", name: "Demo Resort Group", slug: "demo-resort-group", extraUsers: 50, hotels: [
    { code: "DRG-BDR", name: "Demo Resort Bodrum", city: "Bodrum", resort: true, rooms: 110 },
    { code: "DRG-KMR", name: "Demo Resort Kemer", city: "Kemer", resort: true, rooms: 100 },
  ] },
  { key: "C", name: "Demo City Hotel", slug: "demo-city-hotel", extraUsers: 75, hotels: [
    { code: "DCH-ANK", name: "Demo City Ankara", city: "Ankara", resort: false, rooms: 95 },
    { code: "DCH-BRS", name: "Demo City Bursa", city: "Bursa", resort: false, rooms: 85 },
  ] },
  { key: "D", name: "Demo Boutique Hotel", slug: "demo-boutique-hotel", extraUsers: 20, hotels: [
    { code: "DBH-KAP", name: "Demo Boutique Kapadokya", city: "Nevşehir", resort: false, rooms: 60 },
    { code: "DBH-ALC", name: "Demo Boutique Alaçatı", city: "İzmir", resort: true, rooms: 55 },
  ] },
  { key: "E", name: "Demo All Inclusive", slug: "demo-all-inclusive", extraUsers: 30, hotels: [{ code: "DAI-BLK", name: "Demo All Inclusive Belek", city: "Antalya", resort: true, rooms: 160 }] },
];

export const PROFILES: Record<DemoProfile["name"], DemoProfile> = {
  tiny: {
    name: "tiny",
    months: 1,
    orgs: [
      { key: "A", name: "Demo Tiny Group", slug: "demo-tiny-group", extraUsers: 2, hotels: [{ code: "TNY-1", name: "Tiny One", city: "İstanbul", resort: false, rooms: 12 }, { code: "TNY-2", name: "Tiny Two", city: "Antalya", resort: true, rooms: 10 }] },
      { key: "E", name: "Demo Tiny QA", slug: "demo-tiny-qa", extraUsers: 1, hotels: [{ code: "TNY-QA", name: "Tiny QA", city: "Antalya", resort: true, rooms: 10 }] },
    ],
    productsPerHotel: 60,
    recipes: { finished: 10, semi: 3, versioned: 3 },
    posSlots: 1,
    issueSlots: 1,
    freshByWeight: false,
    wastePerDay: 1,
    buffetSessions: 3,
    minibarRoomsPerDay: 1,
    employeesPerHotel: 20,
    dailyExpenses: 2,
  },
  dev: { name: "dev", months: 2, orgs: ORGS_FULL, productsPerHotel: 200, recipes: { finished: 50, semi: 10, versioned: 15 }, posSlots: 2, issueSlots: 1, freshByWeight: false, wastePerDay: 6, buffetSessions: 20, minibarRoomsPerDay: 2, employeesPerHotel: 500, dailyExpenses: 8 },
  staging: { name: "staging", months: 13, orgs: ORGS_FULL, productsPerHotel: 200, recipes: { finished: 50, semi: 10, versioned: 15 }, posSlots: 4, issueSlots: 2, freshByWeight: true, wastePerDay: 15, buffetSessions: 100, minibarRoomsPerDay: 3, employeesPerHotel: 500, dailyExpenses: 28 },
};
