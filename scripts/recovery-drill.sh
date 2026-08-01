#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

: "${RECOVERY_EVIDENCE_DIRECTORY:?Set RECOVERY_EVIDENCE_DIRECTORY to the operator evidence directory}"
source_database="${POSTGRES_DB:-bhayanakcast}"
postgres_user="${POSTGRES_USER:-bhayanakcast}"
read -r drill_id < /proc/sys/kernel/random/uuid
target_database="${source_database}_restore_${drill_id//-/}"
started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restored=false

cleanup() {
  docker compose exec -T postgres psql -X --set ON_ERROR_STOP=1 -U "$postgres_user" -d "$source_database" \
    -c "DELETE FROM public._recovery_drill WHERE drill_id = '$drill_id'" >/dev/null 2>&1 || true
  if [[ "$restored" == true ]]; then
    docker compose exec -T postgres dropdb --if-exists --force -U "$postgres_user" "$target_database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker compose exec -T postgres psql -X --set ON_ERROR_STOP=1 -U "$postgres_user" -d "$source_database" <<SQL
CREATE TABLE IF NOT EXISTS public._recovery_drill (
  drill_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL
);
INSERT INTO public._recovery_drill (drill_id, created_at)
VALUES ('$drill_id', '$started_at');
SQL

backup_file="$(scripts/backup-postgres.sh)"
scripts/restore-postgres.sh "$backup_file" "$target_database"
restored=true
restored_marker="$(docker compose exec -T postgres psql -X -tA --set ON_ERROR_STOP=1 \
  -U "$postgres_user" -d "$target_database" \
  -c "SELECT drill_id FROM public._recovery_drill WHERE drill_id = '$drill_id'")"
if [[ "$restored_marker" != "$drill_id" ]]; then
  printf 'Restored database did not contain recovery marker %s\n' "$drill_id" >&2
  exit 1
fi

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
recovery_seconds="$(( $(date +%s) - started_epoch ))"
evidence_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -- "$RECOVERY_EVIDENCE_DIRECTORY"
evidence="$RECOVERY_EVIDENCE_DIRECTORY/recovery-$evidence_stamp-$drill_id.json"
printf '{\n  "drill_id": "%s",\n  "backup": "%s",\n  "recovery_data_point": "%s",\n  "started_at": "%s",\n  "completed_at": "%s",\n  "recovery_seconds": %s,\n  "verified": true\n}\n' \
  "$drill_id" "$(basename "$backup_file")" "$started_at" "$started_at" "$completed_at" "$recovery_seconds" \
  > "$evidence"
printf '%s\n' "$evidence"
