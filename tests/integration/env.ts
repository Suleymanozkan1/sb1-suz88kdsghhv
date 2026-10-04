process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_test?schema=public";
