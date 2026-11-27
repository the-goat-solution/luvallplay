-- Lane S (Social and Marketplace), Social plan Task 2b: reports, the record
-- of what moderators did, and the evidence kept for child-safety reports.
-- Built hidden (decision AQ): nothing reads or writes these until a club is
-- on the Social pilot list.
--
-- content_reports      a person reports a profile, a post or a comment (later
--                      a listing or a question). The row names the target by
--                      type and id and holds no content. The reporter's own
--                      words (details_sealed) are kept only sealed
--                      (MODERATION_KEKS, bound to the report's id). `queue`
--                      says who handles it: the club the content is in, or
--                      the platform (a serious reason, a report about a
--                      club's own owner or admin, no club, or an overdue
--                      report moved up).
-- moderation_actions   one row for everything a moderator does. Insert only.
--                      It names ids and a short reason, never content.
-- moderation_evidence  for a child_safety report: a sealed copy of the
--                      content as it was when reported, and the author's
--                      account id. Insert only. It stands when the content
--                      and the author's account are deleted.
--
-- Additive: three new, empty tables. No row of any existing table changes,
-- and the app runs unchanged without them.
--
-- Platform-wide, like the tables of 0022: no tenant_id and no row-level
-- security. The club column is club_id and the queries name the club
-- themselves.
CREATE TABLE content_reports (
  id bigserial PRIMARY KEY,
  -- Who reported. Set to NULL when that person deletes their account: the
  -- report stays, with no reporter.
  reporter_id integer,
  target_type text NOT NULL,
  -- A post's or a comment's id; for a profile, the account's id. No foreign
  -- key: the report outlives its target ("content removed").
  target_id bigint NOT NULL,
  -- The club whose space the target is in. NULL: no one club's.
  club_id integer,
  reason text NOT NULL,
  severity text NOT NULL,
  queue text NOT NULL,
  details_sealed text,
  status text DEFAULT 'open' NOT NULL,
  due_at timestamp with time zone NOT NULL,
  -- When the moderators were told the deadline was near. NULL: not yet.
  alerted_at timestamp with time zone,
  -- The moderator's account id. No foreign key: the row stands whatever
  -- happens to that account.
  handled_by integer,
  handled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT content_reports_club_id_fkey FOREIGN KEY (club_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT content_reports_target_type_check CHECK (target_type IN ('profile', 'post', 'comment', 'listing', 'question')),
  -- REPORT_REASONS in @luvallplay/core/social.
  CONSTRAINT content_reports_reason_check CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'child_safety', 'scam', 'prohibited_item', 'other')),
  CONSTRAINT content_reports_severity_check CHECK (severity IN ('normal', 'serious')),
  CONSTRAINT content_reports_queue_check CHECK (queue IN ('club', 'platform')),
  CONSTRAINT content_reports_status_check CHECK (status IN ('open', 'actioned', 'dismissed')),
  -- A serious report is never left to a club, and a club's queue needs a club.
  CONSTRAINT content_reports_serious_is_platform_check CHECK (severity <> 'serious' OR queue = 'platform'),
  CONSTRAINT content_reports_club_queue_has_club_check CHECK (queue <> 'club' OR club_id IS NOT NULL),
  CONSTRAINT content_reports_handled_check CHECK ((status = 'open') = (handled_at IS NULL)),
  -- The sealed format (version.key-id.wrapped-key.data): plain words can't be stored here by mistake.
  CONSTRAINT content_reports_details_sealed_check CHECK (details_sealed ~ '^v1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
-- One open report per person per target: a repeat is the same report.
CREATE UNIQUE INDEX content_reports_one_open_idx ON content_reports (reporter_id, target_type, target_id) WHERE status = 'open';
--> statement-breakpoint
-- The queues: what is open, soonest deadline first; and one club's.
CREATE INDEX content_reports_status_due_idx ON content_reports (status, due_at);
--> statement-breakpoint
CREATE INDEX content_reports_club_idx ON content_reports (club_id, status, due_at) WHERE club_id IS NOT NULL;
--> statement-breakpoint
-- How many reports one target has.
CREATE INDEX content_reports_target_idx ON content_reports (target_type, target_id);
--> statement-breakpoint
CREATE TABLE moderation_actions (
  -- The database alone gives a row its id and its time: the app's role can't
  -- write either column (grants below), so the record can't be back-dated.
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The moderator's account id. NULL: the system (a deadline passed). No
  -- foreign key: the record stands whatever happens to that account.
  actor_id integer,
  target_type text NOT NULL,
  -- As content_reports.target_id. A person is 'profile' with the account's id.
  target_id bigint NOT NULL,
  action text NOT NULL,
  -- A short code or sentence from the moderator. Never the content.
  reason text,
  report_id bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT moderation_actions_report_id_fkey FOREIGN KEY (report_id) REFERENCES content_reports(id) ON DELETE RESTRICT,
  CONSTRAINT moderation_actions_target_type_check CHECK (target_type IN ('profile', 'post', 'comment', 'listing', 'question')),
  CONSTRAINT moderation_actions_action_check CHECK (action IN ('hide', 'restore', 'remove', 'suspend', 'unsuspend', 'club_ban', 'club_unban', 'dismiss')),
  CONSTRAINT moderation_actions_reason_check CHECK (char_length(reason) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_type, target_id, id DESC);
--> statement-breakpoint
CREATE INDEX moderation_actions_report_id_idx ON moderation_actions (report_id) WHERE report_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE moderation_evidence (
  report_id bigint NOT NULL,
  -- The content as it was when reported, sealed (MODERATION_KEKS, bound to
  -- "evidence" and the report's id). Never stored plain.
  sealed text NOT NULL,
  -- The author's account id. No foreign key: it stands when the account goes.
  author_player_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT moderation_evidence_pkey PRIMARY KEY (report_id),
  CONSTRAINT moderation_evidence_report_id_fkey FOREIGN KEY (report_id) REFERENCES content_reports(id) ON DELETE RESTRICT,
  CONSTRAINT moderation_evidence_sealed_check CHECK (sealed ~ '^v1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_reports TO luvallplay_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE content_reports_id_seq TO luvallplay_app;
--> statement-breakpoint
DO $$
BEGIN
  -- New tables get every right by default (0007). Take back what must not
  -- happen: what a moderator did, and the evidence of a child-safety report,
  -- are written once and never changed or removed by the app. (Re-sealing
  -- the evidence after a key rotation is done by the database's owner, as
  -- migrations are.)
  -- Nor may it choose a row's id or time: it may write every column but those.
  REVOKE ALL ON moderation_actions, moderation_evidence FROM luvallplay_app;
  REVOKE ALL ON SEQUENCE moderation_actions_id_seq FROM luvallplay_app;
  GRANT SELECT ON moderation_actions, moderation_evidence TO luvallplay_app;
  GRANT INSERT (actor_id, target_type, target_id, action, reason, report_id) ON moderation_actions TO luvallplay_app;
  GRANT INSERT (report_id, sealed, author_player_id) ON moderation_evidence TO luvallplay_app;
END $$;
