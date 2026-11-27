// A person's rights over their Social data: deleting it with the account,
// and reading it in "Download my data".
//
// forgetSocial() is called by BOTH account-delete paths (lib/app-account.ts
// for the app, app/api/profile/delete for the website) BEFORE
// deletePlayerAccount, and it throws when it can't finish. The caller must
// fail too: the account stays, the person stays signed in and can try again.
// Nobody is signed out with their posts still online.
//
// What goes, for good (rows deleted, not marked):
//   kudos they gave and kudos on their posts; comments they wrote and
//   comments on their posts; their posts; follows and blocks, both ways; a
//   club's ban of them; their post and listing photos, files included; their
//   profile.
// What is emptied:
//   reports they filed stay in the queue with no reporter and no details
//   (reporter_id and details_sealed NULL); a club ban or a handled report
//   forgets that they were the admin behind it (created_by, handled_by NULL).
// What stays, on purpose:
//   player_suspensions (a suspension outlives the account; carrySuspensions
//   first writes it against the email and phone they have now),
//   moderation_actions (ids and codes, no words), moderation_evidence (the
//   sealed copy kept for a child_safety report), and reports ABOUT them or
//   their content: the target is gone, so the queue shows "content removed".
//   And the photo of a post that such evidence is about: the sealed copy
//   holds the photo's URL, not the picture, so deleting the file would
//   destroy the evidence. The post goes; the photo's row stays, marked
//   deleted (out of every read) and marked as kept (its caption says which
//   report); the file stays in the store. Nothing in the app shows it, but
//   the file's public URL still answers to anyone who already has it.
//   Removing it is a person's decision, outside this code
//   (docs/plans/store/child-safety-process.md).
//
// Order, and why nothing is left half done. Everything is ONE transaction on
// one connection. The photo files are removed inside it, as its last step
// before COMMIT, after every row is deleted:
//   - the store can't remove a file -> it throws -> ROLLBACK: every row is
//     as it was. (A file the store did remove before failing is gone; its
//     row is still there and the next try asks the store again, which is
//     not an error.)
//   - the files go but COMMIT fails -> the rows are back, the files are
//     gone; the next try finishes the rows.
// So a retry always completes, and a failure never leaves words online
// without their account or an account without its words.
//
// The account's row is locked for the transaction (FOR UPDATE), so a post,
// comment or follow the person sends at the same moment, and a change of
// their email or phone from another device, waits for the COMMIT instead of
// slipping in half way. carrySuspensions runs under that lock, on the same
// connection. A write can still land between this COMMIT and the account's
// own deletion, so both delete paths call forgetSocial once more afterwards
// (`carry: false`), when no new request of theirs can sign in. What is
// left: a request that was let in just before the deletion and writes after
// that second pass. Its rows belong to a deleted account, so no read shows
// them (socialAccess and every gate check deleted_at), but they are stored.
// A periodic sweep of social rows whose account is deleted would remove
// them; not built.
//
// The lock can meet someone blocking this person at the same moment the
// other way round (their statement holds the follow's row and waits for the
// account's; this one holds the account's and waits for the follow's).
// Postgres stops one of the two with a deadlock error; the whole
// transaction is then run again, up to three times.
//
// TENANT_SCOPE=enforce. The social tables are platform-wide, so all of the
// above is done for every club. player_photos is a club's table: this
// connection sees one club's photos. A photo the person posted in ANOTHER
// club's space is out of reach: its post is deleted, its row and file stay
// until that club's deployment (or a platform job) removes them. Their ids
// are returned and logged, without the person. A photo filed under another
// club that NO post points at (uploaded and never posted, or a listing's)
// can't even be counted: nothing this connection can read knows it exists.
// Lane T's cross-club read or a platform-side sweep would close both; not
// built. Until then Social must not run under `enforce` with a person in
// more than one club.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { moderationSeal, type ModerationSeal } from "../moderation/seal.ts";
import { carrySuspensions, notSuspendedSql } from "../moderation/suspensions.ts";
import { deleteSocialPhotos, type DeleteOptions } from "./photos.ts";
import { socialClubsParam } from "./visible.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; command?: string }>; release(destroy?: Error | boolean): void };
/** A database that can give one connection, for the transaction (lib/database.ts's `sql`, a pg Pool). */
export type RightsDb = Db & { connect(): Promise<TxClient> };
type Env = Record<string, string | undefined>;

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

export type ForgetOptions = {
  env?: Env;
  /** Removes the photo files, and throws when it can't. Default: this deployment's photo store. */
  deleteFiles?: DeleteOptions["deleteFiles"];
  /** Write the person's standing suspensions against their current email and phone first. Default true; false for the pass after the account is deleted. */
  carry?: boolean;
};

export type Forgotten = {
  posts: number;
  comments: number;
  photos: number;
  /** Photos of deleted posts that this connection couldn't see (another club's, under TENANT_SCOPE=enforce): still in the store. */
  unreachablePhotoIds: number[];
  /** Photos kept, file and row, because a child_safety report's evidence is about their post. Every one this account has, not only this call's. */
  retainedForEvidence: number[];
};

// A wait this long for a row another request holds fails the deletion (the person tries again) instead of hanging.
const LOCK_TIMEOUT = "10s";
// Postgres: "deadlock detected". The loser of a deadlock has done nothing; it only has to go again.
const DEADLOCK = "40P01";
const TRIES = 3;
// What marks a kept photo's row (player_photos.caption; a post's photo never has a caption of its own).
const RETAINED = "retained-evidence:report:";

/**
 * What an error is, for a log line: its name and code, never its message. A
 * store's or a driver's message can carry a file's URL, and the URL of a
 * post's photo carries the account's id.
 */
export function errorLabel(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? `${name} (${code})` : name;
}

/**
 * Deletes everything Social holds that this person wrote or that names them,
 * except what moderation must keep (see the top of the file). Throws when it
 * can't finish, and then nothing has changed. Safe to call again, and for an
 * account with no Social data. A deadlock with another request of the same
 * people (someone blocking them at that moment) is tried again, up to three
 * times in all.
 */
export async function forgetSocial(db: RightsDb, playerId: number, options: ForgetOptions = {}): Promise<Forgotten> {
  if (!isId(playerId)) throw new Error("forgetSocial: the account id must be a positive whole number.");
  if (typeof (db as Partial<RightsDb>)?.connect !== "function") throw new Error("forgetSocial: the database must be able to give a connection (connect()), for the transaction.");
  for (let attempt = 1; ; attempt++) {
    try {
      return await forgetOnce(db, playerId, options);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== DEADLOCK || attempt >= TRIES) throw e;
    }
  }
}

async function forgetOnce(db: RightsDb, playerId: number, { env = process.env, deleteFiles, carry = true }: ForgetOptions): Promise<Forgotten> {
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    // Rows that name this account (a new post, comment, follow…) and a change of its email or phone wait for the COMMIT.
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    // Under that lock, before anything is deleted: a suspension must know the email and phone the person has NOW.
    // (`not_found` is an id with no account: there is nothing to carry.)
    if (carry) await carrySuspensions(client, playerId, env);

    // Evidence first. A photo on a post that a child_safety report's evidence is about is kept, file and row.
    const evidence = (
      await client.query(
        `SELECT p.photo_id, min(r.id) AS report_id
         FROM social_posts p
         JOIN content_reports r ON r.target_type = 'post' AND r.target_id = p.id
         JOIN moderation_evidence e ON e.report_id = r.id
         WHERE p.author_id = $1 AND p.photo_id IS NOT NULL GROUP BY p.photo_id`,
        [playerId],
      )
    ).rows;

    const theirs = `SELECT id FROM social_posts WHERE author_id = $1`;
    await client.query(`DELETE FROM social_kudos WHERE player_id = $1 OR post_id IN (${theirs})`, [playerId]);
    const comments = (await client.query(`DELETE FROM social_comments WHERE author_id = $1 OR post_id IN (${theirs}) RETURNING author_id`, [playerId])).rows;
    const posts = (await client.query(`DELETE FROM social_posts WHERE author_id = $1 RETURNING id, photo_id`, [playerId])).rows;
    await client.query(`DELETE FROM social_follows WHERE follower_id = $1 OR followee_id = $1`, [playerId]);
    await client.query(`DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1`, [playerId]);
    await client.query(`DELETE FROM social_club_bans WHERE player_id = $1`, [playerId]);
    await client.query(`UPDATE social_club_bans SET created_by = NULL WHERE created_by = $1`, [playerId]);
    // Their reports stay for the moderators, without them and without their words.
    await client.query(`UPDATE content_reports SET reporter_id = NULL, details_sealed = NULL WHERE reporter_id = $1`, [playerId]);
    // A report they handled as a moderator: the action log still says who.
    await client.query(`UPDATE content_reports SET handled_by = NULL WHERE handled_by = $1`, [playerId]);

    // Photos of the deleted posts that this connection can't see (another club's rows).
    const posted = posts.map((r) => r.photo_id).filter((v) => v !== null).map(Number);
    const seen = posted.length === 0 ? [] : (await client.query(`SELECT id FROM player_photos WHERE id = ANY($1::int[])`, [posted])).rows.map((r) => Number(r.id));
    const unreachablePhotoIds = posted.filter((id) => !seen.includes(id)).sort((a, b) => a - b);

    // The kept photos: out of every read (deleted_at), and marked, so a later call knows them with the post gone.
    let newlyRetained: number[] = [];
    for (const r of evidence) {
      const marked = await client.query(
        `UPDATE player_photos SET deleted_at = COALESCE(deleted_at, now()), caption = $3
         WHERE id = $2 AND player_id = $1 AND purpose = 'social' AND caption IS DISTINCT FROM $3 RETURNING id`,
        [playerId, Number(r.photo_id), `${RETAINED}${Number(r.report_id)}`],
      );
      newlyRetained = newlyRetained.concat(marked.rows.map((x) => Number(x.id)));
    }
    const retainedForEvidence = (
      await client.query(`SELECT id FROM player_photos WHERE player_id = $1 AND purpose IN ('social', 'market') AND deleted_at IS NOT NULL AND caption LIKE $2 ORDER BY id`, [playerId, `${RETAINED}%`])
    ).rows.map((r) => Number(r.id));

    await client.query(`DELETE FROM social_profiles WHERE player_id = $1`, [playerId]);
    // Last, so only the COMMIT can fail after it: the files, then the photo rows (no post points at them now).
    // Throws when the store can't: ROLLBACK.
    const { photos } = await deleteSocialPhotos(client, playerId, { deleteFiles, keep: retainedForEvidence });
    const committed = await client.query("COMMIT");
    // A transaction a failed statement aborted answers COMMIT with ROLLBACK, and no error.
    if (committed?.command !== "COMMIT") throw new Error("forgetSocial: nothing was deleted. The transaction didn't commit.");
    // No person in either line: the ids are enough for whoever has to act.
    if (unreachablePhotoIds.length > 0) {
      console.error(`[social] account deletion: ${unreachablePhotoIds.length} post photo(s) filed under another club can't be reached from this deployment and are still in the store: player_photos ids ${unreachablePhotoIds.join(", ")}.`);
    }
    if (newlyRetained.length > 0) {
      console.error(`[social] account deletion: ${newlyRetained.length} post photo(s) kept, file and row, as evidence for a child-safety report: player_photos ids ${newlyRetained.sort((a, b) => a - b).join(", ")}.`);
    }
    return { posts: posts.length, comments: comments.filter((r) => Number(r.author_id) === playerId).length, photos, unreachablePhotoIds, retainedForEvidence };
  } catch (e) {
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw e;
  } finally {
    if (broken) client.release(broken);
    else client.release();
  }
}

/** Another person, as the export names them: never a real name, an email or an account id. `displayName` is null for someone no longer in sight. */
export type ExportedPerson = { publicId: string; displayName: string | null; since: string };

export type SocialExport = {
  profile: { publicId: string; displayName: string; bio: string; visibility: string; adultConfirmedAt: string; rulesVersion: string; joinedAt: string; updatedAt: string } | null;
  /** Every post of theirs that still exists, whatever its state (held, hidden and removed ones too). */
  posts: { id: number; kind: string; state: string; body: string | null; photoUrl: string | null; createdAt: string }[];
  /** Their comments, with the id of the post each is on (not the post's words: someone else may have written it). */
  comments: { id: number; postId: number; state: string; body: string; createdAt: string }[];
  /** Posts they gave kudos to. */
  kudos: { postId: number; createdAt: string }[];
  following: ExportedPerson[];
  blocked: ExportedPerson[];
  /** Reports they filed: what kind of thing, why, and their own words when the key can open them. Never who or what was reported. */
  reports: { targetType: string; reason: string; status: string; details: string | null; createdAt: string }[];
  /** Clubs that switched them off in their own space. */
  clubBans: { clubId: number; since: string }[];
  /** Suspensions written against this account, and their lifts. No moderator is named. */
  suspensions: { action: string; scope: string; until: string | null; reasonCode: string; createdAt: string }[];
};

export type ExportOptions = { env?: Env; seal?: ModerationSeal };

/**
 * What Social holds that this person wrote or chose, for "Download my data".
 * Nothing written by anyone else: no comments on their posts, no followers,
 * nobody who blocked them. Other people appear by public id, and by display
 * name only while they are still in sight (see below): a name someone took
 * after leaving or being suspended isn't handed out.
 *
 * A report's details are the person's own words, sealed. They are opened
 * when MODERATION_KEKS can open them and left out (null) when it can't: a
 * missing or rotated-away key never fails the download.
 *
 * Every list has a full sort order, so the export is the same every time.
 * Under TENANT_SCOPE=enforce a photo filed under another club isn't visible
 * here, so that post's `photoUrl` is null.
 */
export async function exportSocial(db: Db, playerId: number, { env = process.env, seal }: ExportOptions = {}): Promise<SocialExport> {
  const q = async (text: string) => (await db.query(text, [playerId])).rows;
  const person = (r: Record<string, unknown>): ExportedPerson => ({ publicId: String(r.public_id), displayName: typeof r.display_name === "string" ? r.display_name : null, since: iso(r.created_at) });
  const [profile] = await q(`SELECT public_id, display_name, bio, visibility, adult_confirmed_at, rules_version, created_at, updated_at FROM social_profiles WHERE player_id = $1`);
  const posts = await q(
    `SELECT p.id, p.kind, p.state, p.body, p.created_at, ph.display_url
     FROM social_posts p
     LEFT JOIN player_photos ph ON ph.id = p.photo_id AND ph.player_id = p.author_id AND ph.purpose = 'social' AND ph.deleted_at IS NULL
     WHERE p.author_id = $1 ORDER BY p.created_at, p.id`,
  );
  const comments = await q(`SELECT id, post_id, state, body, created_at FROM social_comments WHERE author_id = $1 ORDER BY created_at, id`);
  const kudos = await q(`SELECT post_id, created_at FROM social_kudos WHERE player_id = $1 ORDER BY created_at, post_id`);
  // Someone they follow or blocked is always listed by public id (it is the person's own choice, and how to undo it).
  // The display name only while that person is still in Social where the exporter could meet them: not suspended,
  // a live account, and a club with Social in common, or an `everyone` profile that still has such a club. (Not the
  // profile gate itself: that hides across a block, and a blocked person's name is what this list is for.)
  const clubs = socialClubsParam(env);
  const allowed = (column: string) => `($2::int[] IS NULL OR ${column} = ANY($2::int[]))`;
  const other = async (table: string, mine: string, theirs: string) =>
    (
      await db.query(
        `SELECT sp.public_id, x.created_at,
                CASE WHEN pl.deleted_at IS NULL AND ${notSuspendedSql("sp.player_id", "social")}
                      AND ( EXISTS (SELECT 1 FROM social_clubs_of($1) AS vc(c) JOIN social_clubs_of(sp.player_id) AS tc(c) USING (c) WHERE ${allowed("c")})
                         OR (sp.visibility = 'everyone' AND EXISTS (SELECT 1 FROM social_clubs_of(sp.player_id) AS tc(c) WHERE ${allowed("tc.c")})))
                     THEN sp.display_name END AS display_name
         FROM ${table} x
         JOIN social_profiles sp ON sp.player_id = x.${theirs}
         JOIN players pl ON pl.id = x.${theirs}
         WHERE x.${mine} = $1 ORDER BY x.created_at, sp.public_id`,
        [playerId, clubs],
      )
    ).rows;
  const following = await other("social_follows", "follower_id", "followee_id");
  const blocked = await other("user_blocks", "blocker_id", "blocked_id");
  const reports = await q(`SELECT id, target_type, reason, status, details_sealed, created_at FROM content_reports WHERE reporter_id = $1 ORDER BY created_at, id`);
  const clubBans = await q(`SELECT club_id, created_at FROM social_club_bans WHERE player_id = $1 ORDER BY created_at, club_id`);
  const suspensions = await q(`SELECT action, scope, until, reason_code, created_at FROM player_suspensions WHERE player_id = $1 ORDER BY id`);

  let opener: ModerationSeal | null = null;
  const details = (r: Record<string, unknown>): string | null => {
    if (typeof r.details_sealed !== "string") return null;
    try {
      opener ??= seal ?? moderationSeal(env);
      return opener.open(Number(r.id), r.details_sealed);
    } catch {
      return null;
    }
  };

  return {
    profile: profile
      ? {
          publicId: String(profile.public_id),
          displayName: String(profile.display_name),
          bio: String(profile.bio ?? ""),
          visibility: String(profile.visibility),
          adultConfirmedAt: iso(profile.adult_confirmed_at),
          rulesVersion: String(profile.rules_version),
          joinedAt: iso(profile.created_at),
          updatedAt: iso(profile.updated_at),
        }
      : null,
    posts: posts.map((r) => ({ id: Number(r.id), kind: String(r.kind), state: String(r.state), body: r.body === null ? null : String(r.body), photoUrl: typeof r.display_url === "string" ? r.display_url : null, createdAt: iso(r.created_at) })),
    comments: comments.map((r) => ({ id: Number(r.id), postId: Number(r.post_id), state: String(r.state), body: String(r.body), createdAt: iso(r.created_at) })),
    kudos: kudos.map((r) => ({ postId: Number(r.post_id), createdAt: iso(r.created_at) })),
    following: following.map(person),
    blocked: blocked.map(person),
    reports: reports.map((r) => ({ targetType: String(r.target_type), reason: String(r.reason), status: String(r.status), details: details(r), createdAt: iso(r.created_at) })),
    clubBans: clubBans.map((r) => ({ clubId: Number(r.club_id), since: iso(r.created_at) })),
    suspensions: suspensions.map((r) => ({ action: String(r.action), scope: String(r.scope), until: r.until === null ? null : iso(r.until), reasonCode: String(r.reason_code), createdAt: iso(r.created_at) })),
  };
}
