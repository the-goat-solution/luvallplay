-- Phase 3b step 7: deleting a child's information is asked for by a guardian
-- and confirmed by the club, and then NOTHING about the child is kept.
--
-- Additive: two new tables and nothing else. Both club-owned with row-level
-- security from the first day.
--
-- junior_deletion_requests: a guardian's request, waiting for an owner or
-- admin of the club. Once confirmed the row no longer points at a child (the
-- child's row is gone): it says only that a request was made, by which
-- account, and who confirmed it and when.
--
-- junior_payment_records: what the payment code needs after a child is
-- deleted, and no more: that a payment with this id was settled for this
-- club, and for how much. No child, no guardian, no play day. With it, a
-- payment event that arrives again is recognised and is neither booked nor
-- refunded a second time.
CREATE TABLE junior_deletion_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  -- The child, while they exist. NULL once a request for them is confirmed: the child is gone.
  junior_profile_id integer,
  -- The guardian who asked.
  requested_by_user_id integer NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  -- The owner or admin who confirmed, or the guardian who cancelled.
  decided_by_user_id integer,
  decided_at timestamp with time zone,
  CONSTRAINT junior_deletion_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_deletion_requests_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT junior_deletion_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_deletion_requests_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_deletion_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text])),
  -- A pending request names its child; a confirmed one holds nothing about the child (nor does a cancelled one once the child is gone).
  CONSTRAINT junior_deletion_requests_child_check CHECK ((status <> 'pending' OR junior_profile_id IS NOT NULL) AND (status <> 'confirmed' OR junior_profile_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX junior_deletion_requests_one_pending ON junior_deletion_requests (tenant_id, junior_profile_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX junior_deletion_requests_junior_profile_id_idx ON junior_deletion_requests (tenant_id, junior_profile_id);
--> statement-breakpoint
CREATE INDEX junior_deletion_requests_requested_by_user_id_idx ON junior_deletion_requests (requested_by_user_id);
--> statement-breakpoint
CREATE INDEX junior_deletion_requests_decided_by_user_id_idx ON junior_deletion_requests (decided_by_user_id);
--> statement-breakpoint
CREATE TABLE junior_payment_records (
  tenant_id integer NOT NULL,
  payment_intent_id text NOT NULL,
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT junior_payment_records_pkey PRIMARY KEY (tenant_id, payment_intent_id),
  CONSTRAINT junior_payment_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
);
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['junior_deletion_requests', 'junior_payment_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
  GRANT SELECT, INSERT, UPDATE ON junior_deletion_requests TO luvallplay_app;
  GRANT SELECT, INSERT ON junior_payment_records TO luvallplay_app;
  -- Records: a request is decided, never removed; a payment record is written once.
  REVOKE DELETE ON junior_deletion_requests FROM luvallplay_app;
  REVOKE UPDATE, DELETE ON junior_payment_records FROM luvallplay_app;
  GRANT USAGE, SELECT ON SEQUENCE junior_deletion_requests_id_seq TO luvallplay_app;
END $$;
