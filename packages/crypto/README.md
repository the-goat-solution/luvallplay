# @luvallplay/crypto

The one envelope every sealed value uses, and the keyed index that lets a sealed value still be looked up. `node:crypto` only; keys are passed in.

- `createSeal` (`src/seal.ts`): AES-256-GCM, a fresh data key per sealing, wrapped by the purpose's key-encryption key, both bound to a context (which club, person, device, child). Wire format `v1.<key id>.<wrapped key>.<data>`. It must not change: rows sealed before must keep opening.
- `parseKeks` (`src/keks.ts`): reads a key list. Malformed throws; empty means "this purpose is unavailable", never "store it unsealed".
- `blindIndex` (`src/blind-index.ts`): HMAC-SHA256 of a value under its own key list, so "who has this phone number?" is an equality lookup.
- `sealedWith`: the key id a sealed text used.

Which columns are sealed, with which key list and binding, is listed in one place: `apps/web/lib/crypto-purposes.ts`. **A new sealed column adds its entry there in the change that creates it**, or its rows are never re-sealed and removing an old key loses them.

## Key lists

One list per purpose, each in its own environment variable. A leak of one purpose's key opens nothing else, and no two purposes may share key bytes.

| Variable | Seals |
|---|---|
| `INTEGRATIONS_KEKS` | a club's provider tokens (no table yet) |
| `PUSH_KEKS` | `push_devices.sealed` |
| `JUNIORS_KEKS` | `junior_medical_notes.sealed` |
| `CONTACT_KEKS` | `players.phone_sealed` |
| `CONTACT_INDEX_KEYS` | `players.phone_index` (an index key, not a sealing key) |
| `MODERATION_KEKS` | `content_reports.details_sealed` (what a reporter wrote), `moderation_evidence.sealed` (the content of a child-safety report) |

**The format is strict:**

```
id:key[,id:key…]
```

- **One line.** Entries separated by commas, newest first: new sealings use the first key; every key listed can still open what it sealed.
- `id`: lower-case letters, digits and hyphens, 1 to 32 characters, unique in the list. It is written into every sealed text, so it is not a secret, and it is never reused for other key bytes.
- `key`: exactly **32 bytes**, in base64 or base64url (43 characters, with or without the `=` at the end).
- Spaces around an entry and a trailing comma are ignored. Anything else is refused, loudly: quotes, a space or line break inside a key, entries separated by line breaks instead of commas, a key of another length, a key of all zeros, an id listed twice.

Make a key on the machine of whoever sets it, and put it straight into the hosting environment's settings. Never into a chat, a ticket, a file in the repository or a command line that is logged:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

**Check production values against the parser before deploying them.** A list the parser refuses stops everything that purpose seals or opens. With the variables set in a shell exactly as they will be in production, from `apps/web`:

```sh
node --input-type=module -e 'import { parseKeks } from "@luvallplay/crypto"; for (const name of process.argv.slice(1)) console.log(name, parseKeks(process.env[name], name).map((k) => k.id));' INTEGRATIONS_KEKS PUSH_KEKS JUNIORS_KEKS CONTACT_KEKS CONTACT_INDEX_KEYS MODERATION_KEKS
```

It prints the key ids in order (the first is the one new sealings will use) and nothing of the keys, or says which list is malformed.

### What production checks as it builds and as it starts

`apps/web/lib/crypto-health.ts`, when `VERCEL_ENV` is `production`. It reads the environment only, and runs twice:

- **As the production build starts** (`next.config.ts`). The **build fails**, nothing is promoted, and the previous deployment keeps serving. This is the check that protects the site.
- **As each server starts** (`instrumentation.ts`), the backstop for a variable that reached a deployment without passing the build. If it trips, the site is not protected: **every request answers 500** until the variable is put right and production is redeployed. (Next doesn't run this hook during a build, which is why the build checks too.)

Both say which variable, and which key ids, never a key. They refuse when:

- a key list is malformed;
- two lists hold the same key (every key of every list is compared, older keys and index keys too);
- `PII_READS` is `sealed` without `CONTACT_KEKS` or `CONTACT_INDEX_KEYS`, or is anything but `plain` or `sealed`;
- `RATE_LIMIT_STORE` is set to anything but `database` or `memory` (a typo such as `db` would quietly count per server);
- `CRYPTO_CHECK_RATE_LIMIT=1` and `RATE_LIMIT_STORE` isn't `database`. (The switch lets this check be deployed before the owner sets `RATE_LIMIT_STORE`; set both together.)

A list that is **not set** doesn't stop it: that purpose is unavailable, its feature refuses when used, and Admin → System check shows it red. The System check lists every key list with its state and key ids, and says whether production would start with the settings of the deployment you are looking at.

So a change to any key list, or to `PII_READS`, can fail the next production build, or, at worst, take the site down. **Before deploying, validate the production values themselves against the parser (above). This is a hard gate, not a courtesy:** the parser is stricter than the one the existing production keys were first accepted by, so a value that has worked for months can still be refused. A preview's System check doesn't answer the question: a preview reads its own environment, not production's.

### `CONTACT_INDEX_KEYS` is as secret as the phone numbers

Phone numbers are few (about 10^8 per country). Anyone who holds `CONTACT_INDEX_KEYS` **and** a copy of the database can recover every phone number offline by trying them all. Treat that key exactly as you would treat the list of numbers itself. It is its own list, never a copy of a sealing key, and each region has its own (the same number has a different index in each region). And while the plain `phone` / `phone_e164` columns exist, sealing adds no secrecy at all: it prepares their removal.

## Rotating a key

**Every production step here needs the owner's OK**, and is done by the owner or with them: the key lists are theirs to set, and the script writes to production data. Rehearse on a copy first when the table is one you haven't rotated before.

The script is `apps/web/scripts/crypto/reseal.mjs` (run from `apps/web`, connected as the database's owner, as for migrations). It reads the key lists from the environment. It prints counts, key ids and row keys only.

**Its first line is `current key: <id>`**, on a dry run and with `--apply`: the key every row will be brought to, which is the first key of the list in *your shell*. Before adding `--apply`, compare it with the first key of the list the servers run with (the parser check above, on the deployed value, prints it). If the list in your shell is in the wrong order (`k1:…,k2:…`), the script would re-seal everything back onto the old key. Stop if the two differ.

If the script can't reach the database it says so in one line and exits 2, having read and written nothing.

**The key id is not the key.** A shell can hold the right id with other key *bytes* (a key made twice, a value pasted from the wrong place). The first line would look right, every row would be re-sealed under a key no server has, and the servers could then open none of them. So before `--apply` writes anything, the script proves the key in your shell against the database:

- **A row the servers already sealed with the current key id must open with your shell's key** (for the index key: a number they indexed with it must give the same index). One such row, in any club, is enough.
- **If rows are on the current key id and none agrees**, the run is refused (exit 2, nothing written): the message names the variable and the key id and says the shell's key differs from the one that sealed the existing rows. Fix the list in your shell; never work around it.
- **If no row is on the current key id yet** (right after the deploy in step 2, or an empty table), the run is refused too. Wait until the servers have sealed at least one row with the new key (a device registering, a note saved, a number verified) and run it again. Only when that can't happen, compare the key in your shell with the deployed value yourself (the same secret store, the same entry, not a copy that passed through anything else) and add `--first-use-of-key`. The flag only covers "no row yet"; it never lets a key through that existing rows contradict.

`scripts/pii/backfill-phone.mjs --apply` makes the same check for `CONTACT_KEKS` and `CONTACT_INDEX_KEYS`. Its very first run has nothing sealed to check against, so it goes ahead and says that no existing row could confirm the keys: then verify one sign-in by phone once the servers have the keys, before relying on what it sealed.

### A sealing key (`PUSH_KEKS`, `JUNIORS_KEKS`, `CONTACT_KEKS`, `MODERATION_KEKS`)

Say the list is `k1:…` and the new key is `k2`.

`MODERATION_KEKS` seals two columns: do steps 3 to 5 once for `content_reports.details_sealed` and once for `moderation_evidence.sealed`, and remove the old key only when both report nothing left on it. (The app's database role can't update `moderation_evidence`; the script connects as the database's owner, as it always does.) The key in your shell is proven per column, against rows of the column being re-sealed. Evidence rows are rare, so after a rotation there is usually none on the new key yet and the evidence run stops and asks for `--first-use-of-key`. Run `content_reports.details_sealed` first: when it has proven the key and re-sealed, run `moderation_evidence.sealed` with `--first-use-of-key` **from the same shell**, so it is the same key.

1. **Add the new key first in the list, keeping the old one:** `k2:…,k1:…`. Check it against the parser (above).
2. **Deploy.** From now on new sealings use `k2`; everything sealed with `k1` still opens.
   While the deploy rolls out, a server still running with the old list can't open what a new server just sealed with `k2`. If that short gap matters, deploy `k1:…,k2:…` first (every server learns `k2`, nothing uses it yet), then `k2:…,k1:…`.
3. **Dry run**, with the same list in the environment:

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose push_devices.sealed
   ```

   It says `current key: k2` first, then how many rows are on each key id, and writes nothing. If it names any key but the new one, the list in your shell isn't the deployed one: stop.
4. **Re-seal:**

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose push_devices.sealed --apply
   ```

   (A host listed in `PRODUCTION_DATABASE_HOSTS` also needs `--production`.) Before the first write it proves your shell's key against a row the servers sealed with `k2` (above); with no such row yet it stops and says so. It works through the rows not on the current key, 100 per transaction. It is safe to stop and to run again: every row is either as it was or fully re-sealed, and opens either way; a row the app writes meanwhile is left as the app wrote it. Only the sealed column is written.
5. **Verify nothing is left on the old key:** run the dry run again. It must list **0** rows on `k1` and report 0 to re-seal. If the run exited 1, some rows were left with a problem (named by their key, with the reason): look at each before going on. Removing `k1` makes whatever is still sealed with it unreadable for good.
6. **Only then remove the old key** from the list (`k2:…`) and deploy.
   Backups and restore points taken before step 4 still hold rows sealed with `k1`. Keep `k1` somewhere safe (not in the app's settings) until those backups have expired, or accept that a restore from them can't open those rows.

Purposes: `push_devices.sealed` (`PUSH_KEKS`), `junior_medical_notes.sealed` (`JUNIORS_KEKS`; a club-owned table, worked through one club at a time), `players.phone_sealed` (`CONTACT_KEKS`; needs `CONTACT_INDEX_KEYS` set too, and brings each row's index to the current index key in the same write).

### The index key (`CONTACT_INDEX_KEYS`)

The same number has a different index under each key, so the order matters more here.

1. **Add the new key in two deploys. This is mandatory once the plain phone column is gone, and the safe habit before:** first `i1:…,i2:…` on every server (all of them learn `i2`; nothing uses it yet), and only when no server runs without `i2`, `i2:…,i1:…`. Check each list against the parser.
   Servers with *different* lists disagree about a number's index: one that only knows `i1` can't see that a number was just verified under `i2`, so two accounts could verify the same number, each under its own key's index. Today the unique index on the plain column still refuses the second; without the plain column nothing would.
   After the second deploy, new and changed numbers are indexed with `i2`. Lookups (sign-in by phone) match the index under **every** listed key, and "this number is already someone's" is checked under every listed key, so rows still on `i1` keep working.
2. **Wait until every server runs with the new list** (the deploy has finished and no instance of the previous deployment is still serving) **before running the script.** The script re-indexes to the first `CONTACT_INDEX_KEYS` key in your shell. A server that doesn't have that key yet can't compute the new index, so with `PII_READS=sealed` it can't find a re-indexed account by its phone number (sign-in by phone fails for those accounts on that server) until it runs with the new list. The same holds for `--purpose players.phone_sealed`, which re-indexes in the same write. Check that the script's first line (`current key: i2`) names the first key of the deployed list.
3. **Dry run**, then **re-index** (needs `CONTACT_KEKS` too: the number is read from the row's own sealed copy). `--apply` first proves your shell's `i2` against a number the servers indexed with it, as above:

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose contact-index
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose contact-index --apply
   ```

4. **Verify:** the dry run again must list **0** rows on `i1` (and none without a key id).
5. **Only then remove `i1`** and deploy. A row still indexed with `i1` after that is not found by its number: its owner can't sign in by phone until the row is re-indexed.

Rotating `CONTACT_KEKS` and `CONTACT_INDEX_KEYS` together: put both new keys first, deploy, wait until every server runs with the new lists (step 2), and run `--purpose players.phone_sealed --apply`; it does both. Then run the `contact-index` dry run as well before removing the old index key (a row already on the new sealing key is not visited by `players.phone_sealed`).

Before the plain phone columns are dropped (a later project), read the precondition recorded in `docs/rehearsals/2026-11-pii-phone-sealed.md`: with several index keys listed and no plain column, two servers with different lists could verify one number for two accounts.

### If a key has leaked

Rotate as above, at once. Rotation stops the leaked key from opening anything sealed **from now on** and, after the re-seal, anything in the live database. It does not undo the leak: whoever holds the old key and an older copy of the database (a backup, a dump) can still open that copy. For `CONTACT_INDEX_KEYS`, see the warning above: with an older copy of the database, the numbers in it are recoverable.
