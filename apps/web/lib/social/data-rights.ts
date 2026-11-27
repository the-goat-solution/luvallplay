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
// comment or follow the person sends at the same moment waits for the
// COMMIT instead of slipping in half way. It can still land between this
// COMMIT and the account's own deletion, so both delete paths call
// forgetSocial once more afterwards (`carry: false`), when no new request
// of theirs can sign in.
//
// TENANT_SCOPE=enforce. The social tables are platform-wide, so all of the
// above is done for every club. player_photos is a club's table: this
// connection sees one club's photos. A photo the person posted in ANOTHER
// club's space is out of reach: its post is deleted, its row and file stay
// until that club's deployment (or a platform job) removes them. Their ids
// are returned and logged, without the person. Lane T's cross-club read
// would close this; not built.
//
// Takes a small `Db`, like lib/juniors/family.ts, so tests and scripts share it.
import { moderationSeal, type ModerationSeal } from "../moderation/seal.ts";
import { carrySuspensions } from "../moderation/suspensions.ts";
import { deleteSocialPhotos, type DeleteOptions } from "./photos.ts";

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
};

// A wait this long for a row another request holds fails the deletion (the person tries again) instead of hanging.
const LOCK_TIMEOUT = "10s";

/**
 * Deletes everything Social holds that this person wrote or that names them,
 * except what moderation must keep (see the top of the file). Throws when it
 * can't finish, and then nothing has changed. Safe to call again, and for an
 * account with no Social data.
 */
export async function forgetSocial(db: RightsDb, playerId: number, { env = process.env, deleteFiles, carry = true }: ForgetOptions = {}): Promise<Forgotten> {
  if (!isId(playerId)) throw new Error("forgetSocial: the account id must be a positive whole number.");
  if (typeof (db as Partial<RightsDb>)?.connect !== "function") throw new Error("forgetSocial: the database must be able to give a connection (connect()), for the transaction.");
  // Before anything is deleted: a suspension must know the email and phone the person has now.
  // (`not_found` is an id with no account: there is nothing to carry.)
  if (carry) await carrySuspensions(db, playerId, env);

  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    // Rows that name this account (a new post, comment, follow…) wait for the COMMIT.
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
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

    await client.query(`DELETE FROM social_profiles WHERE player_id = $1`, [playerId]);
    // Last, so only the COMMIT can fail after it: the files, then the photo rows (no post points at them now).
    // Throws when the store can't: ROLLBACK.
    const { photos } = await deleteSocialPhotos(client, playerId, { deleteFiles });
    const committed = await client.query("COMMIT");
    // A transaction a failed statement aborted answers COMMIT with ROLLBACK, and no error.
    if (committed?.command !== "COMMIT") throw new Error("forgetSocial: nothing was deleted. The transaction didn't commit.");
    if (unreachablePhotoIds.length > 0) {
      // No person in the line: the ids are enough for whoever runs that club's deployment.
      console.error(`[social] account deletion: ${unreachablePhotoIds.length} post photo(s) filed under another club can't be reached from this deployment and are still in the store: player_photos ids ${unreachablePhotoIds.join(", ")}.`);
    }
    return { posts: posts.length, comments: comments.filter((r) => Number(r.author_id) === playerId).length, photos, unreachablePhotoIds };
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

/** Another person, as the export names them: never a real name, an email or an account id. */
export type ExportedPerson = { publicId: string; displayName: string; since: string };

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
 * nobody who blocked them. Other people appear by display name and public id
 * only, and only while they still have a profile and an account.
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
  const person = (r: Record<string, unknown>): ExportedPerson => ({ publicId: String(r.public_id), displayName: String(r.display_name), since: iso(r.created_at) });
  const [profile] = await q(`SELECT public_id, display_name, bio, visibility, adult_confirmed_at, rules_version, created_at, updated_at FROM social_profiles WHERE player_id = $1`);
  const posts = await q(
    `SELECT p.id, p.kind, p.state, p.body, p.created_at, ph.display_url
     FROM social_posts p
     LEFT JOIN player_photos ph ON ph.id = p.photo_id AND ph.player_id = p.author_id AND ph.purpose = 'social' AND ph.deleted_at IS NULL
     WHERE p.author_id = $1 ORDER BY p.created_at, p.id`,
  );
  const comments = await q(`SELECT id, post_id, state, body, created_at FROM social_comments WHERE author_id = $1 ORDER BY created_at, id`);
  const kudos = await q(`SELECT post_id, created_at FROM social_kudos WHERE player_id = $1 ORDER BY created_at, post_id`);
  const other = (table: string, mine: string, theirs: string) =>
    q(
      `SELECT sp.public_id, sp.display_name, x.created_at
       FROM ${table} x
       JOIN social_profiles sp ON sp.player_id = x.${theirs}
       JOIN players pl ON pl.id = x.${theirs} AND pl.deleted_at IS NULL
       WHERE x.${mine} = $1 ORDER BY x.created_at, sp.public_id`,
    );
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
