/**
 * Subscription e-mails. The audit (v2) found none at all: a trial ended into read-only mode with only an in-app
 * banner as warning, and invitations had to be copied by hand.
 *
 * Every e-mail is recorded in SubscriptionNotice under a unique (company, key) BEFORE it is sent, so the nightly job
 * can run twice (retry, two instances) without e-mailing twice. Without a mail server (SMTP_URL) the attempt is still
 * recorded with ok = false and the reason: visible to the operator, never a silent success.
 *
 * Texts are Turkish: the customers are Turkish hotels.
 */
import { Prisma } from "@prisma/client";
import type { Db } from "../db";
import { accessState, type AccessState } from "@/domain/billing";
import { billingEnabled } from "../plans";
import { mailConfigured, sendMail } from "../mail";
import { errorFields, log } from "../log";
import { money } from "@/lib/format";

const day = (d: Date) => d.toISOString().slice(0, 10);
// billing dates are UTC calendar days (periods end at 23:59:59.999 UTC)
const trDate = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "UTC" });

/** Who receives subscription e-mails: the invoice address if set, else the company administrators. */
export async function noticeRecipients(db: Db, organizationId: string): Promise<string[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { billingEmail: true } });
  if (org.billingEmail) return [org.billingEmail];
  const admins = await db.user.findMany({ where: { organizationId, active: true, role: { permissions: { has: "admin:users" } } }, select: { email: true }, take: 5 });
  return admins.map((a) => a.email);
}

/** Records the notice under its unique key, then sends it. false = already sent before (or nobody to send to). */
export async function sendNotice(db: Db, organizationId: string, kind: string, key: string, subject: string, text: string): Promise<boolean> {
  const to = await noticeRecipients(db, organizationId);
  if (!to.length) return false;
  let id: string;
  try {
    id = (await db.subscriptionNotice.create({ data: { organizationId, kind, key: `${kind}:${key}`, recipients: to.join(", "), ok: false } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
  const footer = "\n\nHotelCost\nBu e-posta abonelik durumunuz hakkında otomatik gönderilmiştir.";
  const results = await Promise.all(to.map((addr) => sendMail({ to: addr, subject, text: text + footer })));
  const failed = results.find((r) => !r.ok) as { ok: false; error: string } | undefined;
  await db.subscriptionNotice.update({ where: { id }, data: { ok: !failed, error: failed?.error ?? null } });
  if (failed && mailConfigured()) log.warn("notice e-mail failed", { organizationId, kind, error: failed.error });
  return !failed;
}

/** The reminder a company is due today, if any, with the key that makes it once-only. */
export function dueReminder(state: AccessState, daysLeft: number | null, end: Date | null): { kind: string; key: string } | null {
  if (!end) return null;
  if (state === "TRIAL" && (daysLeft === 7 || daysLeft === 1)) return { kind: `TRIAL_${daysLeft}`, key: day(end) };
  if (state === "PAST_DUE") return { kind: "GRACE", key: day(end) };
  if (state === "EXPIRED") return { kind: "EXPIRED", key: day(end) };
  return null;
}

/** Nightly: trial T-7 / T-1, start of the grace period, expiry. Only where billing applies. */
export async function runSubscriptionNotices(db: Db, now = new Date()): Promise<{ checked: number; sent: number }> {
  if (!(await billingEnabled(db))) return { checked: 0, sent: 0 };
  const orgs = await db.organization.findMany({ where: { isDemo: false, isPlatform: false, active: true }, select: { id: true, name: true, trialEndsAt: true, paidThrough: true } });
  let sent = 0;
  for (const o of orgs) {
    try {
      const a = accessState({ trialEndsAt: o.trialEndsAt, paidThrough: o.paidThrough }, now);
      const lastEnd = new Date(Math.max(o.paidThrough?.getTime() ?? 0, o.trialEndsAt?.getTime() ?? 0));
      const r = dueReminder(a.state, a.daysLeft, a.state === "TRIAL" ? o.trialEndsAt : lastEnd.getTime() ? lastEnd : null);
      if (!r) continue;
      const msg = reminderText(r.kind, o.name, a.daysLeft ?? 0, a.graceEndsAt);
      if (await sendNotice(db, o.id, r.kind, r.key, msg.subject, msg.text)) sent++;
    } catch (e) {
      log.error("notices: company failed", { organizationId: o.id, ...errorFields(e) });
    }
  }
  return { checked: orgs.length, sent };
}

function reminderText(kind: string, company: string, daysLeft: number, graceEndsAt: Date | null): { subject: string; text: string } {
  switch (kind) {
    case "TRIAL_7":
    case "TRIAL_1":
      return {
        subject: `HotelCost: ücretsiz denemenizin bitmesine ${daysLeft} gün kaldı`,
        text: `${company} için HotelCost ücretsiz denemesinin bitmesine ${daysLeft} gün kaldı.\n\nDeneme bittikten sonra 7 gün boyunca kayıt girmeye devam edebilirsiniz; bu süre içinde abonelik başlamazsa verileriniz silinmez, görüntülenebilir ve dışa aktarılabilir kalır, yalnızca yeni kayıtlar duraklatılır.\n\nAbonelik ve ödeme bilgileri: uygulamada Şirket > Abonelik.`,
      };
    case "GRACE":
      return {
        subject: "HotelCost: ödeme bekleniyor",
        text: `${company} için deneme ya da ödenmiş dönem sona erdi. ${graceEndsAt ? trDate(graceEndsAt) : "Birkaç gün"} tarihine kadar kayıt girmeye devam edebilirsiniz; sonrasında verileriniz salt okunur olur.\n\nÖdeme bildirimi ve havale bilgileri: uygulamada Şirket > Abonelik.`,
      };
    default:
      return {
        subject: "HotelCost: aboneliğiniz sona erdi",
        text: `${company} için HotelCost aboneliği sona erdi. Verileriniz güvende: görüntüleyebilir ve dışa aktarabilirsiniz, ancak yeni kayıtlar ödeme yapılana kadar duraklatıldı.\n\nAbonelik ve ödeme bilgileri: uygulamada Şirket > Abonelik.`,
      };
  }
}

/** Sent right after a payment notice is issued (with the transfer details when the operator entered them). */
export async function noticeInvoiceIssued(db: Db, organizationId: string, inv: { number: string; total: { toString(): string }; currency: string; dueDate: Date }, bank: { bankName: string; accountName: string; iban: string } | null) {
  const iban = bank?.iban ? `\n\nHavale bilgileri\nBanka: ${bank.bankName || "-"}\nHesap adı: ${bank.accountName || "-"}\nIBAN: ${bank.iban.replace(/(.{4})/g, "$1 ").trim()}\nAçıklama: ${inv.number}` : "";
  await sendNotice(db, organizationId, "INVOICE", inv.number, `HotelCost ödeme bildirimi ${inv.number}`, `Yeni ödeme bildiriminiz: ${inv.number}\nTutar (KDV dahil): ${money(inv.total.toString(), inv.currency)}\nSon ödeme: ${trDate(inv.dueDate)}${iban}\n\nBu bir ödeme bildirimidir (proforma); yasal fatura ayrıca düzenlenir.`).catch((e) => log.error("notice: invoice e-mail failed", { organizationId, ...errorFields(e) }));
}

export async function noticePaymentReceived(db: Db, organizationId: string, inv: { number: string }, paidThrough: Date) {
  await sendNotice(db, organizationId, "PAID", inv.number, `HotelCost: ödemeniz alındı (${inv.number})`, `${inv.number} numaralı ödeme bildiriminin ödemesi alındı. Aboneliğiniz ${trDate(paidThrough)} tarihine kadar geçerli. Teşekkür ederiz.`).catch((e) => log.error("notice: payment e-mail failed", { organizationId, ...errorFields(e) }));
}

/** Invitation e-mail (the link is still shown to the inviter as before, for messaging apps). */
export async function sendInvitationEmail(to: string, organization: string, link: string, expiresAt: Date): Promise<boolean> {
  if (!mailConfigured()) return false;
  const r = await sendMail({
    to,
    subject: `${organization}: HotelCost davetiniz`,
    text: `${organization} sizi HotelCost'a davet etti.\n\nHesabınızı oluşturmak için bağlantıyı açın:\n${link}\n\nBağlantı ${trDate(expiresAt)} tarihine kadar geçerlidir ve yalnızca bir kez kullanılabilir.`,
  });
  if (!r.ok) log.warn("invitation e-mail failed", { error: r.error });
  return r.ok;
}
