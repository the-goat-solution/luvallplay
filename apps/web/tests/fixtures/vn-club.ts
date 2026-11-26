// A synthetic Vietnamese club, for test databases only (Track V; test plan
// §8 "Demo clubs: synthetic clubs for each country").
//
// Nobody here is real: the names are common Vietnamese family, middle and
// given names combined by a fixed rule, the emails are @example.com, and the
// phone numbers are a made-up block that is never texted (side effects are
// off outside production, and this never runs in production: see the guard).

import { VN_PACK } from "@luvallplay/core/country-pack-vn";
import { calledName } from "@luvallplay/core/country-pack";

export const VN_TEST_CLUB = {
  slug: "demo-cau-long-ha-noi",
  name: "CLB Cầu lông Hồ Tây (demo)",
  country: VN_PACK.country,
  region: VN_PACK.region,
  timezone: VN_PACK.timezone,
  currency: VN_PACK.currency,
  languages: [...VN_PACK.languages],
  sports: ["badminton", "pickleball"],
  // Bank transfer with a VietQR code (§6.5): the default in Vietnam.
  payment_mode: "offline",
  // Whole dong.
  casualFee: 50000,
  monthlyFee: 400000,
  // A made-up account at a real bank's BIN, for VietQR tests.
  bank: { bin: "970436", account: "1029384756", accountName: "CLB CAU LONG HO TAY" },
} as const;

const FAMILY = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ"];
const MIDDLE = ["Văn", "Thị", "Hữu", "Ngọc", "Minh", "Thùy", "Đức", "Thanh"];
const GIVEN = ["An", "Bình", "Châu", "Dũng", "Đạt", "Giang", "Hà", "Hương", "Khánh", "Linh", "Mai", "Nam", "Oanh", "Phúc", "Quỳnh", "Sơn", "Thảo", "Uyên", "Việt", "Yến"];

export type VnTestMember = { fullName: string; family: string; rest: string; called: string; email: string; phone: string };

/** 36 members, the same every time. */
export const VN_TEST_MEMBERS: VnTestMember[] = Array.from({ length: 36 }, (_, i) => {
  const family = FAMILY[i % FAMILY.length];
  const rest = `${MIDDLE[(i * 3) % MIDDLE.length]} ${GIVEN[(i * 7) % GIVEN.length]}`;
  const fullName = `${family} ${rest}`;
  return { fullName, family, rest, called: calledName(fullName, "family-first"), email: `vn-demo-${i + 1}@example.com`, phone: `+849000000${String(i + 1).padStart(2, "0")}` };
});

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Database names this may write to. Anything else, production above all, is refused. */
const TEST_DATABASE = /^(dg_test|site_test|e2e_|vn_pack_|tenants_|scratch_|test_)|_test$/;

/**
 * Creates the club and its members in a migrated test database, and returns
 * the club's id. Refuses any database that isn't named as a test database.
 */
export async function seedVietnamTestClub(c: Client): Promise<number> {
  const db = String((await c.query("SELECT current_database() AS db")).rows[0].db);
  if (!TEST_DATABASE.test(db) || process.env.VERCEL_ENV === "production") {
    throw new Error(`The Vietnamese demo club is for test databases only, and "${db}" isn't named as one.`);
  }
  const t = VN_TEST_CLUB;
  const tenant = await c.query(
    `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, bank_details)
     VALUES ($1, $2, 'setup', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [t.slug, t.name, t.country, t.region, t.timezone, t.currency, t.languages, t.sports, t.payment_mode, JSON.stringify(t.bank)],
  );
  const tenantId = Number(tenant.rows[0].id);
  for (const m of VN_TEST_MEMBERS) {
    // Until profiles have one full-name field (§6.9), the family name sits in last_name and the rest in first_name.
    const p = await c.query(
      `INSERT INTO players (email, first_name, last_name, display_name, phone, phone_e164, lang, created_via)
       VALUES ($1, $2, $3, $4, $5, $5, 'vi', 'admin') RETURNING id`,
      [m.email, m.rest, m.family, m.called, m.phone],
    );
    await c.query(`INSERT INTO club_members (tenant_id, user_id) VALUES ($1, $2)`, [tenantId, p.rows[0].id]);
  }
  return tenantId;
}
