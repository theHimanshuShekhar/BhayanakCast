CREATE OR REPLACE FUNCTION refresh_all_access_session_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_subject_id text;
BEGIN
  account_subject_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.account_id
    ELSE NEW.account_id
  END;
  UPDATE "user" account
     SET all_access_blocked_indefinite = EXISTS (
           SELECT 1
             FROM platform_sanction sanction
            WHERE sanction.account_id = account_subject_id
              AND sanction.type = 'all_access'
              AND sanction.starts_at <= clock_timestamp()
              AND sanction.lifted_at IS NULL
              AND sanction.expires_at IS NULL
         ),
         all_access_blocked_until = (
           SELECT max(sanction.expires_at)
             FROM platform_sanction sanction
            WHERE sanction.account_id = account_subject_id
              AND sanction.type = 'all_access'
              AND sanction.starts_at <= clock_timestamp()
              AND sanction.lifted_at IS NULL
              AND sanction.expires_at > clock_timestamp()
         )
   WHERE account.id = account_subject_id;
  RETURN NULL;
END
$$;
