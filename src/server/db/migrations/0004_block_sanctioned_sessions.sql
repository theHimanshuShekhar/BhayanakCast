CREATE FUNCTION block_all_access_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id = NEW.user_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
      FROM platform_sanction
     WHERE account_id = NEW.user_id
       AND type = 'all_access'
       AND starts_at <= clock_timestamp()
       AND lifted_at IS NULL
       AND (expires_at IS NULL OR expires_at > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'all-access sanction blocks session creation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER block_all_access_session
BEFORE INSERT ON session
FOR EACH ROW EXECUTE FUNCTION block_all_access_session();