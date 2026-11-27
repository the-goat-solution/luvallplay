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

**The format is strict:**

```
id:key[,id:key…]
```

- **One line.** Entries separated by commas, newest first: new sealings use the first key; every key listed can still open what it sealed.
- `id`: lower-case letters, digits and hyphens, 1 to 32 characters, unique in the list. It is written into every sealed text, so it is not a secret, and it is never reused for other key bytes.
- `key`: exactly **32 bytes**, in base64 or base64url (43 characters, with or without the `=` at the end).
- Spaces around an entry and a trailing comma are ignored. Anything else is refused, loudly: quotes, a space or line break inside a key, entries separated by line breaks instead of commas, a key of another length, an id listed twice.

Make a key on the machine of whoever sets it, and put it straight into the hosting environment's settings. Never into a chat, a ticket, a file in the repository or a command line that is logged:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

**Check production values against the parser before deploying them.** A list the parser refuses stops everything that purpose seals or opens. With the variables set in a shell exactly as they will be in production, from `apps/web`:

```sh
node --input-type=module -e 'import { parseKeks } from "@luvallplay/crypto"; for (const name of process.argv.slice(1)) console.log(name, parseKeks(process.env[name], name).map((k) => k.id));' PUSH_KEKS JUNIORS_KEKS CONTACT_KEKS CONTACT_INDEX_KEYS
```

It prints the key ids in order (the first is the one new sealings will use) and nothing of the keys, or says which list is malformed.

### `CONTACT_INDEX_KEYS` is as secret as the phone numbers

Phone numbers are few (about 10^8 per country). Anyone who holds `CONTACT_INDEX_KEYS` **and** a copy of the database can recover every phone number offline by trying them all. Treat that key exactly as you would treat the list of numbers itself. It is its own list, never a copy of a sealing key, and each region has its own (the same number has a different index in each region). And while the plain `phone` / `phone_e164` columns exist, sealing adds no secrecy at all: it prepares their removal.

## Rotating a key

**Every production step here needs the owner's OK**, and is done by the owner or with them: the key lists are theirs to set, and the script writes to production data. Rehearse on a copy first when the table is one you haven't rotated before.

The script is `apps/web/scripts/crypto/reseal.mjs` (run from `apps/web`, connected as the database's owner, as for migrations). It reads the key lists from the environment. It prints counts, key ids and row keys only.

### A sealing key (`PUSH_KEKS`, `JUNIORS_KEKS`, `CONTACT_KEKS`)

Say the list is `k1:…` and the new key is `k2`.

1. **Add the new key first in the list, keeping the old one:** `k2:…,k1:…`. Check it against the parser (above).
2. **Deploy.** From now on new sealings use `k2`; everything sealed with `k1` still opens.
   While the deploy rolls out, a server still running with the old list can't open what a new server just sealed with `k2`. If that short gap matters, deploy `k1:…,k2:…` first (every server learns `k2`, nothing uses it yet), then `k2:…,k1:…`.
3. **Dry run**, with the same list in the environment:

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose push_devices.sealed
   ```

   It lists how many rows are on each key id and writes nothing.
4. **Re-seal:**

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose push_devices.sealed --apply
   ```

   (A host listed in `PRODUCTION_DATABASE_HOSTS` also needs `--production`.) It works through the rows not on the current key, 100 per transaction. It is safe to stop and to run again: every row is either as it was or fully re-sealed, and opens either way; a row the app writes meanwhile is left as the app wrote it. Only the sealed column is written.
5. **Verify nothing is left on the old key:** run the dry run again. It must list **0** rows on `k1` and report 0 to re-seal. If the run exited 1, some rows were left with a problem (named by their key, with the reason): look at each before going on. Removing `k1` makes whatever is still sealed with it unreadable for good.
6. **Only then remove the old key** from the list (`k2:…`) and deploy.
   Backups and restore points taken before step 4 still hold rows sealed with `k1`. Keep `k1` somewhere safe (not in the app's settings) until those backups have expired, or accept that a restore from them can't open those rows.

Purposes: `push_devices.sealed` (`PUSH_KEKS`), `junior_medical_notes.sealed` (`JUNIORS_KEKS`; a club-owned table, worked through one club at a time), `players.phone_sealed` (`CONTACT_KEKS`; needs `CONTACT_INDEX_KEYS` set too, and brings each row's index to the current index key in the same write).

### The index key (`CONTACT_INDEX_KEYS`)

The same number has a different index under each key, so the order matters more here.

1. **Add the new key first, keeping the old one:** `i2:…,i1:…`. Check it against the parser. Deploy.
   New and changed numbers are indexed with `i2`. Lookups (sign-in by phone) match the index under **every** listed key, and "this number is already someone's" is checked under every listed key, so rows still on `i1` keep working.
2. **Dry run**, then **re-index** (needs `CONTACT_KEKS` too: the number is read from the row's own sealed copy):

   ```sh
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose contact-index
   POSTGRES_URL=… node scripts/crypto/reseal.mjs --purpose contact-index --apply
   ```

3. **Verify:** the dry run again must list **0** rows on `i1` (and none without a key id).
4. **Only then remove `i1`** and deploy. A row still indexed with `i1` after that is not found by its number: its owner can't sign in by phone until the row is re-indexed.

Rotating `CONTACT_KEKS` and `CONTACT_INDEX_KEYS` together: put both new keys first, deploy, and run `--purpose players.phone_sealed --apply`; it does both. Then run the `contact-index` dry run as well before removing the old index key (a row already on the new sealing key is not visited by `players.phone_sealed`).

Before the plain phone columns are dropped (a later project), read the precondition recorded in `docs/rehearsals/2026-11-pii-phone-sealed.md`: with several index keys listed and no plain column, two servers with different lists could verify one number for two accounts.

### If a key has leaked

Rotate as above, at once. Rotation stops the leaked key from opening anything sealed **from now on** and, after the re-seal, anything in the live database. It does not undo the leak: whoever holds the old key and an older copy of the database (a backup, a dump) can still open that copy. For `CONTACT_INDEX_KEYS`, see the warning above: with an older copy of the database, the numbers in it are recoverable.
