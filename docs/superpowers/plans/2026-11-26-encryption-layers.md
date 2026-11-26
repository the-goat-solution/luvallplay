# Encryption layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tested sealing library for every purpose, searchable sealed phone numbers, key rotation, a production check that refuses a malformed or reused key, and rate limits that hold across server instances.

**Architecture:** Sealing is already done three times, nearly identically (`lib/integrations/token-vault.ts`, `lib/push/seal.ts`, `lib/juniors/care.ts` via the vault). Move the envelope (AES-256-GCM data key per sealing, wrapped by a key-encryption key, bound to context through AAD, wire format `v1.<kek-id>.<wrapped-key>.<data>`) into a pure package `@luvallplay/crypto` and keep the wire format byte for byte, so every row sealed today still opens. On top of it: a keyed blind index (HMAC-SHA256) so a sealed value can still be looked up, a re-seal script for rotation (which also recomputes blind indexes), a start-up check, and a shared rate limiter for signed-in endpoints (today they count per instance: `lib/app-api.ts:220`) with a per-player lock for daily caps. Social and Marketplace depend on Task 8.

**Tech Stack:** Node `node:crypto` only (no new dependency), TypeScript, `node:test`, Postgres via the existing migration queue.

**Spec:** `docs/plans/luvallplay-build-plan.md` §12.1 (tokens sealed per club), §6.8 (medical notes sealed), §4.8 step 6b (push addresses sealed), audit `docs/plans/luvallplay-audit-2026-11-25.md` H6 and H9; the index `./2026-11-26-social-marketplace-security-index.md`.

## Global Constraints

- Wire format stays `v1.<kek-id>.<wrapped-dek>.<data>`, base64url parts, 12-byte IV, 16-byte tag. Rows sealed today must open with the new code.
- Key lists use the format `id:base64key[,id:base64key…]`: 32-byte keys, ids `^[a-z0-9-]{1,32}$`, newest first. A malformed list **throws**; an empty list means "this purpose is unavailable", never "store plain text".
- One key list per purpose: `INTEGRATIONS_KEKS`, `PUSH_KEKS`, `JUNIORS_KEKS` (existing), `CONTACT_KEKS`, `CONTACT_INDEX_KEYS`, `MODERATION_KEKS` (new). A leak of one purpose's key opens nothing else, with one exception the plan states plainly: phone numbers are a small space (about 10^8 per country), so **anyone holding `CONTACT_INDEX_KEYS` and a copy of the database can recover every phone number offline**. The index key is as secret as the numbers themselves. And while the plain `phone`/`phone_e164` columns exist, sealing adds no confidentiality at all: it prepares their removal. Each region has its own keys (the same number hashes differently in each region).
- Every "can't open" failure (wrong binding, changed text, wrong key) gives the same message, on purpose.
- Data keys are zeroed (`fill(0)`) after use.
- Sealed values, plaintext, and blind indexes are never logged, never copied into the audit log, never returned by an API other than to the person they belong to.
- Migrations are additive and numbered when they merge (build plan §9.4). Production data steps only with the owner's OK, under the data-change protocol, with a rehearsal note in `docs/rehearsals/`.
- No new npm dependency.
- No two purposes may share key bytes (an operator pasting one key into two variables). The start-up check refuses it.
- New purposes start their binding with a constant naming the purpose (`"player.phone"`, `"report"`), so text sealed for one purpose can't be opened as another's even with a shared key.

## Review Focus

1. **A row sealed before this change** must open after it. Task 1's compatibility test uses ciphertext produced by today's `token-vault.ts` and `push/seal.ts`.
2. **A key list with stray whitespace or a trailing comma** (common in pasted env vars) must parse the same as the clean one. Task 1 test.
3. **Phone numbers written differently** (`021 123 4567`, `+64 21 123 4567`, `+64211234567`) must give the same blind index. Task 3 test, using the existing E.164 normaliser in `@luvallplay/core/phone`.
4. **A re-seal interrupted half-way** must leave every row openable, and running it again must finish the job. Task 5 test.
5. **A production deploy with a malformed key, a key reused across purposes, or `PII_READS=sealed` without its keys** must fail loudly at start. A purpose with no key answers `503 <purpose>_unavailable` when used and shows red on the System check. Task 6 test.
6. **Deleting or merging an account** must leave no `phone_sealed`/`phone_index` behind, whichever code path cleared the plain number. Task 4 test (enforced by a database trigger, not by remembering every writer).
7. **Twelve requests in parallel against a cap of ten**, across two server instances, must let at most ten through. Task 8 test.

---

### Task 1: `@luvallplay/crypto`, the shared envelope

**Files:**
- Create: `packages/crypto/package.json` (name `@luvallplay/crypto`, `type: module`, exports `"."` → `./src/index.ts`, script `typecheck`), `packages/crypto/tsconfig.json` (extends `../tsconfig.base.json`)
- Create: `packages/crypto/src/keks.ts`, `packages/crypto/src/seal.ts`, `packages/crypto/src/index.ts`
- Modify: `apps/web/next.config.ts` (`transpilePackages` gains `@luvallplay/crypto`), `apps/web/package.json` (workspace dependency)
- Test: `apps/web/tests/crypto-seal.test.ts`, fixture `apps/web/tests/fixtures/crypto/v1-vectors.json`

**Interfaces:**
- Produces:
  - `type Kek = { id: string; key: Buffer }`
  - `parseKeks(raw: string | undefined, name: string): Kek[]`: `name` is the env var's name, used in error messages
  - `class SealError extends Error`
  - `type Binding = readonly (string | number)[]`: must be non-empty; numbers must be positive safe integers; strings non-empty
  - `createSeal(opts: { purpose: string; keks: () => Kek[] }): { seal(binding: Binding, plaintext: string): string; open(binding: Binding, sealed: string): string; available(): boolean }`
  - `sealedWith(sealed: string): string | null`
- AAD per part is `JSON.stringify(["v1", part, ...prefix, ...binding])` where `part` is `"dek" | "data"`. `prefix` is what keeps today's ciphertext valid: the integrations vault used `[tenantId, connector, connectionId]` and push used `["push", playerId, deviceId]`. So the binding is passed through exactly, and `purpose` is **not** put into the AAD (it names the key list in errors only). Each caller's binding starts with its own constant (`"push"`, a connector name) as today.

- [ ] **Step 1: Make the compatibility vectors.** A one-off script in your scratch space seals three known plaintexts with **today's** `tokenVault` (binding `{ tenantId: 1, connector: "juniors.medical", connectionId: "child:9" }`) and **today's** `pushSeal` (binding `{ playerId: 3, deviceId: 7 }`), with fixed test keys. Save `{ keks, cases: [{ binding, plaintext, sealed }] }` to the fixture, where each `binding` is the array the new API takes (`[1, "juniors.medical", "child:9"]`, `["push", 3, 7]`).

- [ ] **Step 2: Write the failing tests**

```ts
test("opens every v1 vector sealed by the old code", () => {
  for (const c of vectors.cases) assert.equal(seal.open(c.binding, c.sealed), c.plaintext);
});
test("a different binding, a changed byte or an unknown key all fail with the same message", () => {
  const s = seal.seal([1, "x", "y"], "hello");
  for (const bad of [() => seal.open([2, "x", "y"], s), () => seal.open([1, "x", "y"], s.slice(0, -2) + "AA")])
    assert.throws(bad, /can't be opened/);
  assert.throws(() => seal.open([1, "x", "y"], s.replace(".k1.", ".gone.")), /isn't available/);
});
test("rotation: seals with the first key, opens with any listed", () => { /* keks k2,k1: sealedWith(new) === "k2"; old k1 text opens */ });
test("parseKeks trims spaces and ignores empty parts", () => {
  assert.deepEqual(parseKeks(` k1:${K} , `, "X").map((k) => k.id), ["k1"]);
});
test("parseKeks throws on a short key, a bad id or a repeated id, naming the variable", () => {
  assert.throws(() => parseKeks("k1:short", "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
});
test("no key: available() is false and seal throws; nothing is ever returned unsealed", () => {});
test("an empty binding or a non-positive number is refused", () => {
  assert.throws(() => seal.seal([], "x"), SealError);
  assert.throws(() => seal.seal([0, "a"], "x"), SealError);
});
```

- [ ] **Step 3: Run** `pnpm --filter web exec node --import ./tests/register.mjs --test tests/crypto-seal.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement** `keks.ts` (from `token-vault.ts`'s `parseKeks`, plus trimming and the `name` argument) and `seal.ts` (the existing `encrypt`/`decrypt`/envelope, generalised to `Binding`).

- [ ] **Step 5: Run** the test file and `pnpm --filter "./packages/*" typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(crypto): one shared envelope for every sealed value, same wire format`

### Task 2: The three existing callers use it (no behaviour change)

**Files:**
- Modify: `apps/web/lib/integrations/token-vault.ts`: `tokenVault()` wraps `createSeal({ purpose: "integrations", keks })` with binding `[tenantId, connector, connectionId]`; keep its exports (`parseKeks` re-exported, `VaultError`, `sealedWith`, `deploymentVault`, `vaultConfigured`) so no other file changes
- Modify: `apps/web/lib/push/seal.ts`: binding `["push", playerId, deviceId]`; keep `PushSealError`, `pushSeal`, `pushSealAvailable`
- `apps/web/lib/juniors/care.ts` needs no change (it uses `tokenVault`)
- Test: existing `push-devices.test.ts`, `juniors-care.test.ts`, `juniors-rights.test.ts`, `juniors-roster.test.ts`, integration vault tests

**Interfaces:** Consumes `createSeal`, `parseKeks`, `SealError` from Task 1. Produces nothing new.

- [ ] **Step 1:** Map `SealError` to each module's own error class so callers' `instanceof` checks keep working (catch and rethrow with the same message).
- [ ] **Step 2: Run** `pnpm --filter web test` with `DATA_GUARD_TEST_URL` set to a local Postgres. Expected: every existing test passes **unchanged**. A test edit in this task means the change isn't behaviour-neutral: stop and look.
- [ ] **Step 3: Commit** `refactor: the integrations vault and push sealing use @luvallplay/crypto`

### Task 3: Blind index for lookups on sealed values

**Files:**
- Create: `packages/crypto/src/blind-index.ts`, export from `index.ts`
- Test: `apps/web/tests/crypto-blind-index.test.ts`

**Interfaces:**
- Produces: `blindIndex(opts: { purpose: string; keys: () => Kek[] }): { current(value: string): { kid: string; mac: string }; all(value: string): { kid: string; mac: string }[] }`
  - `mac` = `base64url(HMAC-SHA256(key, purpose + "\0" + value))`; `current` uses the first key; `all` gives one per listed key (for lookups during a rotation). The key id is returned **separately** so a unique index on `mac` works.
  - Callers normalise the value first; the index doesn't.

- [ ] **Step 1: Failing tests:** same value and key give the same index; a different purpose gives a different index; `all()` during a rotation contains the old key's index; no keys means `current` throws `SealError`; the output contains no part of the input.
- [ ] **Step 2: Run** and check it fails, **Step 3: Implement**, **Step 4: Run** and check it passes.
- [ ] **Step 5: Commit** `feat(crypto): keyed blind index so sealed values can still be found`

### Task 4: Players' phone numbers sealed, with a searchable index

Email stays in plain text in this plan: it's the join key in `attendance`, `player_absences`, `auth_codes`, `casual_play_profiles` and `players`. Sealing it needs those tables moved to `user_id` first (the links from migration `0005`), which is its own project. Write that down in the build plan's lane H log as "PII-2: email to user_id joins, then seal".

**Files:**
- Create: `packages/db/migrations/00NN_players_contact_sealed.sql` (number at merge): `ALTER TABLE players ADD COLUMN phone_sealed text, ADD COLUMN phone_index text, ADD COLUMN phone_index_kid text;` with a `CHECK` that `phone_sealed` matches the `v1.…` format; `CREATE UNIQUE INDEX players_phone_index_verified ON players (phone_index) WHERE phone_verified_at IS NOT NULL AND deleted_at IS NULL;` (mirrors today's `players_phone_verified_idx`; the table has under 1,000 rows); and a `BEFORE UPDATE` trigger `players_phone_sealed_follows_plain`: when `NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164` and the statement didn't also change `phone_sealed`, set `phone_sealed`, `phone_index`, `phone_index_kid` to NULL. That covers every writer of the plain column, including ones this task doesn't touch. Update `packages/db/schema.ts` and `meta/_journal.json`.
- Create: `apps/web/lib/pii/contact.ts`
- Modify: `apps/web/lib/player-db.ts`: the writers at lines 186 (`coalesce(phone_e164, $5)`), 208 (insert), 247–248 (profile update) and 262 (`markPhoneVerified`) also write the sealed columns through `contact.ts`; the lookup at line 126 goes through `findByPhone`; `deletePlayerAccount` (298) also nulls the three new columns explicitly.
- Modify: `apps/web/lib/player-merge.ts:307,320`: the wipe nulls the sealed columns; the copy-over re-seals for the kept player (the binding includes the player id, so the dupe's sealed text can't be copied).
- Read only: `apps/web/lib/juniors/roster.ts:66` reads `phone_e164`, which stays until the plain column goes.
- Create: `scripts/pii/backfill-phone.mjs` (dry run by default, `--apply` to write; batches of 200; idempotent: only rows where `phone_e164 IS NOT NULL AND phone_sealed IS NULL`)
- Test: `apps/web/tests/pii-contact.test.ts` (database test, pattern of `push-devices.test.ts`)
- Docs: `docs/rehearsals/2026-11-pii-phone-sealed.md`

**Interfaces:**
- Consumes: `createSeal`, `blindIndex` (Tasks 1, 3); `toE164` from `@luvallplay/core/phone`.
- Produces (in `lib/pii/contact.ts`):
  - `phoneSealing(env?: Env): { available(): boolean; seal(playerId: number, e164: string): { sealed: string; index: string; indexKid: string }; open(playerId: number, sealed: string): string; indexes(e164: string): string[] }`. While a rotation is under way, `markPhoneVerified` checks "taken" against every `indexes()` value, not just the unique index, binding `["player.phone", playerId]`, keys `CONTACT_KEKS`, index keys `CONTACT_INDEX_KEYS`
  - `PII_READS` env: `"plain"` (default) or `"sealed"`. With `"sealed"`, `findByPhone` matches on `phone_index = ANY($indexes)`; otherwise on `phone_e164`. Writes always fill both while the plain column exists.

- [ ] **Step 1: Failing tests:** Review Focus 6: after `deletePlayerAccount`, after a merge wipe, and after a raw `UPDATE players SET phone_e164 = NULL` (the trigger), no `phone_sealed`/`phone_index` is left; a merge re-seals for the kept player and the number is found under the kept id; two verified accounts can't share a `phone_index` (`markPhoneVerified` returns taken); writing a phone fills `phone_sealed` (no digits of the number appear in it) and `phone_index`; `findByPhone` finds the player from three spellings of the number under both `PII_READS` values; with `CONTACT_KEKS` unset, writes still store the plain column and leave the sealed ones `NULL` (today's behaviour), and `PII_READS=sealed` is refused at start (Task 6); the backfill run twice changes nothing the second time; a deleted account isn't found.
- [ ] **Step 2: Run** and check it fails. **Step 3: Implement.** **Step 4: Run** `pnpm --filter web test` and `pnpm --filter web db:drift`. Expected: PASS, no drift.
- [ ] **Step 5: Rehearse** on a Neon branch copy of production: migrate, backfill dry run (count), backfill `--apply`, compare `count(*) WHERE phone_e164 IS NOT NULL` with `count(*) WHERE phone_index IS NOT NULL`. Write the counts to the rehearsal note.
- [ ] **Step 6: Commit** `feat(pii): players' phone numbers sealed with a searchable index (reads stay plain until the owner switches)`

Production (migrate, backfill, then `PII_READS=sealed` a week later) is booked in the Phase 3 runbook's calendar and run only with the owner's OK. Dropping `phone`/`phone_e164` isn't in this plan.

### Task 5: Key rotation: re-seal what an old key sealed

**Files:**
- Create: `scripts/crypto/reseal.mjs`
- Create: `apps/web/lib/crypto-purposes.ts`
- Test: `apps/web/tests/crypto-reseal.test.ts` (database test)
- Docs: a "Rotating a key" section in `packages/crypto/README.md`

**Interfaces:**
- Produces: `PURPOSES: readonly { purpose: string; env: string; table: string; column: string; binding: (row: Record<string, unknown>) => Binding; module?: string }[]` with one entry per sealed column: the integrations connection tokens (no table yet: add the entry in the PR that creates it), `push_devices.sealed`, `junior_medical_notes.sealed`, `players.phone_sealed`; Social and Marketplace add theirs.
- CLI: `node scripts/crypto/reseal.mjs --purpose <name> [--apply]` lists the count per KEK id (using `sealedWith`) and, with `--apply`, re-seals rows not on the current key, 100 per transaction, `UPDATE … WHERE id = $1 AND <column> = $old` so a concurrent write wins. For `players.phone_sealed` the same `UPDATE` also recomputes `phone_index`/`phone_index_kid` with the current index key; `--purpose contact-index` re-indexes rows whose `phone_index_kid` isn't the current index key (needed when only `CONTACT_INDEX_KEYS` rotates).

- [ ] **Step 1: Failing test:** seal 250 rows with `k1`, set keys to `k2,k1`, run with `--apply` and stop it after the first batch (inject a failure); every row still opens; run again; every row is on `k2`; a third run reports 0 to do. Then rotate `CONTACT_INDEX_KEYS` (`i2,i1`), run `--purpose contact-index --apply`, **drop `i1`**, and `findByPhone` still finds every player (phone sign-in keeps working).
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(crypto): re-seal script for key rotation, safe to stop and re-run`

### Task 6: Fail closed in production when a key is missing

**Files:**
- Create: `apps/web/lib/crypto-health.ts`
- Modify: `apps/web/instrumentation.ts` (call `assertCryptoReady()` in `register()` when `VERCEL_ENV === "production"`), the System check page (`/admin/setup`) gains one row per purpose
- Test: `apps/web/tests/crypto-health.test.ts`

**Interfaces:**
- Consumes: `PURPOSES` (Task 5), `parseKeks`.
- Produces: `cryptoStatus(env: Env): { purpose: string; state: "ok" | "missing" | "malformed"; keyIds: string[] }[]` and `assertCryptoReady(env?: Env): void`.
- Deploy order: Task 6's production check and the owner setting `RATE_LIMIT_STORE=database` go out together. Until Task 8 merges, the rate-limit condition is behind `CRYPTO_CHECK_RATE_LIMIT=1` so Task 6 can't break production on its own.
- `assertCryptoReady` throws when any purpose is `malformed`, when two purposes share key bytes, when `PII_READS=sealed` lacks `CONTACT_KEKS` or `CONTACT_INDEX_KEYS`, or (production only) when `RATE_LIMIT_STORE` isn't `database` (Task 8). It does **not** read module switches. Those are scoped to one club by row-level security at start-up, so the answer would be wrong. A purpose that's `missing` shows red on the System check, and the feature answers `503 <purpose>_unavailable` when used, as push does today.

- [ ] **Step 1: Failing tests:** each throw above; a missing key doesn't throw; the System check row shows the state and the key **ids**, never key material.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** `feat(crypto): production refuses to start with a malformed or reused key`

### Task 7: What stays on the phone

**Files:**
- Modify: `apps/app/src/lib/hooks.tsx`, `apps/app/src/screens/me/data.ts` (audit H9: query keys use the session hash from `lib/offline.ts`, never the token)
- Modify: `apps/native/android/app/src/main/AndroidManifest.xml` only if the test below fails (`android:allowBackup="false"`, `android:dataExtractionRules` excluding the WebView's local storage)
- Test: `apps/app` unit test `offline-keys.test.ts`; extend `apps/native/tests/shell.test.ts`

- [ ] **Step 1: Failing tests:** after signing in and loading Home, nothing in the persisted `lp.cache` contains the token string; the Android manifest disables backup of app data; the iOS project's entitlements set `NSFileProtectionComplete` for the app's data (add `com.apple.developer.default-data-protection` = `NSFileProtectionComplete` when the iOS project lands, and leave a failing-when-present test now).
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** `fix(app): the session token never lands in the offline cache; app data isn't backed up`

### Task 8: Rate limits and daily caps that hold across instances

**Files:**
- Modify: `apps/web/lib/app-api.ts:220`: every non-GET endpoint (public or session) counts in the shared store (`rateLimit` from `lib/security.ts`); GET endpoints stay per instance unless they set `rateLimit.shared: true`
- Modify: `packages/api/src/endpoint.ts`: `rateLimit` gains optional `shared?: boolean` and `failClosed?: boolean`
- Modify: `apps/web/lib/security.ts`: `rateLimit(key, limit, windowMs, db, opts?: { failClosed?: boolean })`; with `failClosed`, a store error returns `"unavailable"` and the route answers `503 rate_limit_unavailable` instead of falling back to memory
- Create: `apps/web/lib/player-lock.ts`
- Test: `apps/web/tests/shared-rate-limit.test.ts` (database test)

**Interfaces:**
- Produces:
  - `withPlayerLock<T>(pool: { connect(): Promise<Db & { release(): void }> }, playerId: number, scope: string, fn: (tx: Db) => Promise<T>): Promise<T>` takes a client, runs `BEGIN`, `SELECT pg_advisory_xact_lock(hashtext($scope), $playerId)`, then `fn(tx)`, then `COMMIT` (or `ROLLBACK` and rethrow), and always releases the client. This is the pattern of `lib/juniors/data-rights.ts:99`. Social and Marketplace call it around every "count, then insert" cap (posts a day, active listings, questions a day, open commitments).
  - Social and Marketplace endpoints set `failClosed: true` on every write.

- [ ] **Step 1: Failing tests:** Review Focus 7: two `pg` pools as two "instances", 12 parallel calls of a capped write against a limit of 10, at most 10 pass; `withPlayerLock` with 12 parallel "count then insert, cap 10" leaves exactly 10 rows; a store error with `failClosed` gives `unavailable` and without it falls back to memory (today's behaviour, unchanged for existing endpoints); the API contract compat check still passes.
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `fix(api): write limits hold across server instances; a per-player lock for daily caps`

---

**After all tasks:** the production setting `RATE_LIMIT_STORE=database` is the owner's (it's needed before the Task 6 check is deployed: book it with the deploy). Then `pnpm typecheck`, `pnpm --filter web exec eslint . --max-warnings 0`, `pnpm --filter web test`, `pnpm --filter web build`. Then dispatch `backend-design:security-reviewer` on the branch diff and fix what it confirms.
