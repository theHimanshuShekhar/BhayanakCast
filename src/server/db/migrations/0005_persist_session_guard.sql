ALTER TABLE "user" ADD COLUMN "all_access_blocked_until" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "all_access_blocked_indefinite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION block_all_access_session() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  blocked_until timestamp;
  blocked_indefinite boolean;
BEGIN
  SELECT all_access_blocked_until, all_access_blocked_indefinite
    INTO blocked_until, blocked_indefinite
    FROM "user"
   WHERE id = NEW.user_id
   FOR UPDATE;
  IF blocked_indefinite OR blocked_until > clock_timestamp() THEN
    RAISE EXCEPTION 'all-access sanction blocks session creation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION refresh_all_access_session_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  subject_id text;
BEGIN
  subject_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.account_id
    ELSE NEW.account_id
  END;
  UPDATE "user"
     SET all_access_blocked_indefinite = EXISTS (
           SELECT 1
             FROM platform_sanction
            WHERE account_id = subject_id
              AND type = 'all_access'
              AND starts_at <= clock_timestamp()
              AND lifted_at IS NULL
              AND expires_at IS NULL
         ),
         all_access_blocked_until = (
           SELECT max(expires_at)
             FROM platform_sanction
            WHERE account_id = subject_id
              AND type = 'all_access'
              AND starts_at <= clock_timestamp()
              AND lifted_at IS NULL
              AND expires_at > clock_timestamp()
         )
   WHERE id = subject_id;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER refresh_all_access_session_guard
AFTER INSERT OR UPDATE OR DELETE ON platform_sanction
FOR EACH ROW EXECUTE FUNCTION refresh_all_access_session_guard();--> statement-breakpoint
UPDATE "user" account
   SET all_access_blocked_indefinite = EXISTS (
         SELECT 1
           FROM platform_sanction
          WHERE account_id = account.id
            AND type = 'all_access'
            AND starts_at <= clock_timestamp()
            AND lifted_at IS NULL
            AND expires_at IS NULL
       ),
       all_access_blocked_until = (
         SELECT max(expires_at)
           FROM platform_sanction
          WHERE account_id = account.id
            AND type = 'all_access'
            AND starts_at <= clock_timestamp()
            AND lifted_at IS NULL
            AND expires_at > clock_timestamp()
       );