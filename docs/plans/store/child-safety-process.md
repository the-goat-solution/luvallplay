# When a child-safety report arrives: who does what (lane S)

The process behind the public standards page (`/safety/child-safety` on luvallplay.com) and the answer to "who reports to the authority, and how" (Social plan, Task 7). It covers a report filed with the reason **`child_safety`** on a post, a comment or a profile (later a listing or a question), and anything a moderator finds that belongs under it whatever reason was picked.

**This is an operating procedure, not legal advice.** Every line marked **counsel** must be confirmed in writing before Social is switched on for real players (gate Z, build plan §8). Where counsel's answer differs from this page, counsel's answer wins and this page is changed.

## Who

| Role | Who | Notes |
|---|---|---|
| **Child-safety lead** (the named moderator) | `____________________` (**owner decision, gate Z: not filled in**) | A platform moderator: their sign-in email is in `PLATFORM_MODERATOR_EMAILS`. Reads the `SAFETY_CONTACT_EMAIL` mailbox |
| **Backup** | `____________________` (**owner decision**) | Covers leave and nights, so 12 hours is always met |
| **Owner** | The company's owner | Told of every child-safety report the same day. Decides anything this page doesn't cover |
| **Club owners, admins and coaches** | **Nobody.** | A child-safety report never goes to a club and is never visible in a club's queue. The club is not told who was reported or who reported |

Only a platform moderator handles these reports. The code holds that line: a serious report can only be in the platform queue (a database check on `content_reports`), and its alert goes to `PLATFORM_MODERATOR_EMAILS` through its own sender, never to a club's alert list.

## The clock

- **Due within 12 hours** of the report (`REPORT_DUE_HOURS.serious`). The deadlines job emails the platform moderators at 75% of the time (9 hours). "Handled" means steps 1 to 4 below are done, not that the matter is closed.
- A second report about the same thing with the reason `child_safety` raises the open report to child safety; nothing is lost behind an earlier "spam".
- The response times are published (the standards page, the store notes). They are the owner's promise at gate Z: don't publish them before the two names above are filled in.

## What the system has already done

When the report was filed, in the same statement:

- A **sealed evidence copy** was written to `moderation_evidence`: the reported words as they were at that moment, and the author's account id. It is sealed with `MODERATION_KEKS`, bound to that report, and never stored in plain text.
- It **stays** when the content is edited or deleted, and when the author deletes their account.
- If `MODERATION_KEKS` isn't set, no copy can be kept: the report is still taken, and the System check page shows the key red. **A missing key is an incident: tell the owner at once.**
- Nothing was hidden and nobody was suspended. A report alone never does that; a moderator decides.

## Steps

**1. Suspend first, then look.** Before opening anything, suspend the reported account across all clubs (Platform → Moderation → Suspend; start with 30 days, it can be made permanent or lifted). This stops further contact while you work. The person is not told why. If the report is plainly mistaken (see step 5), lift the suspension the same day.

**2. Hide the content.** Use **Hide**, not Remove, until step 4 is done: hiding takes it out of every feed at once and keeps the row and any photo file where the authority may need them. **To confirm when Task 7 is built:** that Remove on a photo post does not delete the stored file while a child-safety report on it is open.

**3. Look at as little as needed.** The target is shown blurred until you choose to look. Open the evidence copy only if the report's reason and the surrounding facts don't already tell you what to do. One person looks, once. See "Never" below.

**4. Report to the authority.** The child-safety lead makes the report, the same day, and writes down the reference number they are given.

| Where the people or the club are | Report to | Status |
|---|---|---|
| **New Zealand** | The Department of Internal Affairs' **Digital Child Exploitation Team** (the DIA's online report form for child sexual abuse material). If a child is in danger now, **111** (Police) first | The channel is the plan's. **Counsel**: what the company must report, how fast, and what it must keep and for how long |
| **Vietnam** | **To confirm with counsel.** The build plan names no channel. (The public standards page gives players the police number 113 and the national child protection line 111; that is advice to the public, not the company's reporting route) | Open. Also for counsel: what Decree 147/2024 and the child-protection rules ask of the platform |
| **United States, or because a store asks** | **To confirm with counsel:** whether a report to NCMEC's CyberTipline is required or expected of this company (the stores' child-safety policies refer to reporting to "relevant authorities") | Open |
| Anywhere else | Ask counsel before acting, the same day | |

Give the authority what it asks for, through the channel it gives. The sealed evidence copy and the stored file are handed over only to the authority, and only by the child-safety lead.

**5. Decide and record.** After the authority has been told (or has said no report is needed):

- Confirmed or likely: make the suspension **permanent** (scope "all"). The suspension carries keyed fingerprints of the person's email and phone, so deleting the account and signing up again stays suspended.
- Mistaken (for example an ordinary team photo of adults, reported under the wrong reason): lift the suspension, restore the content, dismiss the report with a short reason.
- Unclear: keep the suspension, ask the owner.

**6. Tell the reporter** only that the report was received and acted on. Never what was found, or what happened to the other person.

**7. Tell the owner** the same day: that a report came in, what was done, the authority's reference.

## Never

- **Never view, download, screenshot, copy or forward the material beyond what steps 3 and 4 need.** Not to a colleague, not to the owner, not to the club, not to yourself. Not into email, chat, a ticket, or this repository.
- **Never tell the reported person** that they were reported for this, that an authority was told, or who reported them. Don't warn them, question them or ask them to explain.
- **Never tell the club** or anyone in it.
- **Never delete** the evidence copy, the report, or the stored file while the matter is open. The app's own database role can't change or delete `moderation_evidence` or `moderation_actions`.
- **Never investigate** beyond this page (no searching for the child, no contacting families). That is the authority's work.
- **Never put the content, names or details in a log, an export, an audit row or an alert email.** Alerts carry a reason and a link only.

## The record

Every action above writes one row to **`moderation_actions`**: who acted (the moderator's account id), on what (type and id), which action (`hide`, `suspend`, `remove`, `restore`, `unsuspend`, `dismiss`), a short reason of at most 200 characters, the report, and the time set by the database. Rows are append-only: the app's database role can insert and read them and can't update or delete them.

In the reason, write codes, not content: for example `child_safety: suspended pending authority`, `child_safety: reported to DIA, ref <number>`, `child_safety: mistaken report, restored`.

Kept outside the app, by the child-safety lead, in the company's own restricted store (**owner decision: where**): the authority's reference number, the date and channel of the report, and any instruction the authority gave. **Counsel**: how long each of these, the evidence copy and the suspension record must be kept, and when they must be destroyed.

## When the reported person deletes their account

Deleting an account deletes the person's posts, comments and photos. It does **not** delete what a child-safety report needs:

- The sealed evidence copy, the report and the action log stay (the app can't delete them).
- **The photo of a reported post stays too, file and row.** The evidence copy holds the photo's address, not the picture, so the file is the evidence. The post is deleted; the photo's row in `player_photos` is kept, marked deleted (nothing in the app shows it) and marked with the report it is kept for (`caption` = `retained-evidence:report:<id>`). The account deletion logs the photo ids, nothing else. This holds for every child-safety report that has an evidence copy, open or closed.
- **Who deletes a kept file, and when: nobody yet.** Nothing in the app removes it. It is removed by hand, by the child-safety lead, after the authority has what it needs and the retention period has passed. **Retention period: ______ (counsel, decision 4).**
- **Open: the kept file's address still works.** The photo store is public: anyone who already has the file's address can still fetch it, although no page shows it. The proper fix is to move a kept file to a private store when it is kept, and delete the public one. **Not built.** Until it is, the lead removes the public file as soon as the authority has its copy, or sooner if the authority says to.
- **Not covered: a post the author deletes themselves** before deleting the account (or without deleting it). Deleting a post removes its photo's file at once, reported or not. That is the post-delete path's (decision 8 below, with Remove).
- Under `TENANT_SCOPE=enforce` a photo filed under another club isn't touched at all by the deletion, so it stays as well.

## What isn't built yet (27 Nov 2026)

The tables, the sealing, the 12-hour deadline and the routing to the platform queue exist (migrations `0022`, `0023`; `apps/web/lib/moderation`). The platform review page, the suspend button, the blur, opening the evidence copy and the deadline emails are Social plan Task 7. Until they exist, this process can't be run, and Social must not be on for any real club.

## Open decisions

| # | Decision | Whose |
|---|---|---|
| 1 | The child-safety lead and the backup, by name | Owner (gate Z) |
| 2 | The published response times (12 and 24 hours are the plan's) | Owner (gate Z) |
| 3 | `SAFETY_CONTACT_EMAIL`: the address, and who reads it at weekends | Owner |
| 4 | New Zealand: the duties to report and to keep, and the retention periods | Counsel |
| 5 | Vietnam: the reporting channel and the platform's duties | Counsel |
| 6 | NCMEC CyberTipline: whether to register and report | Counsel |
| 7 | Where the authority's references are kept outside the app | Owner |
| 8 | Whether Remove, and the author's own delete of a post, keep a photo's file while a child-safety report has evidence about it (account deletion does) | Lane S, Task 7 and Task 4 |
| 9 | How long a kept photo file is held, who deletes it, and moving kept files to a private store | Counsel and owner; lane S to build |
