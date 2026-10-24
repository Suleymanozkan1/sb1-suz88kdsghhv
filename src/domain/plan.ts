/** Subscription packages (Temel / Orta / Üst), mirrored from the Prisma enum so the domain layer stays database-free. */
export type Plan = "BASIC" | "STANDARD" | "PREMIUM";
export const PLANS: readonly Plan[] = ["BASIC", "STANDARD", "PREMIUM"];
export const planRank = (p: Plan) => PLANS.indexOf(p);
