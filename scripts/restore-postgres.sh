#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if (( $# != 2 )); then
  printf 'Usage: %s BACKUP_FILE CLEAN_TARGET_DATABASE\n' "$0" >&2
  exit 2
fi
backup_file="$1"
target_database="$2"
source_database="${POSTGRES_DB:-bhayanakcast}"
: "${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to the backup passphrase file}"

if [[ ! -r "$backup_file" || ! -s "$backup_file" ]]; then
  printf 'Backup is not a readable non-empty file: %s\n' "$backup_file" >&2
  exit 1
fi
if [[ ! "$target_database" =~ ^[a-z][a-z0-9_]*$ ]]; then
  printf 'Target database must be a lowercase PostgreSQL identifier\n' >&2
  exit 1
fi
if [[ "$target_database" == "$source_database" ]]; then
  printf 'Refusing to restore over the production database\n' >&2
  exit 1
fi
if [[ "$target_database" != "${source_database}_restore_"* ]]; then
  printf 'Target database must begin with %s_restore_\n' "$source_database" >&2
  exit 1
fi
if [[ -f "$backup_file.sha256" ]]; then
  (cd "$(dirname "$backup_file")" && sha256sum --check "$(basename "$backup_file").sha256")
fi

docker compose exec -T postgres dropdb --if-exists --force -U "${POSTGRES_USER:-bhayanakcast}" "$target_database"
docker compose exec -T postgres createdb -U "${POSTGRES_USER:-bhayanakcast}" "$target_database"
cleanup_failed_restore() {
  docker compose exec -T postgres dropdb --if-exists --force -U "${POSTGRES_USER:-bhayanakcast}" "$target_database" >/dev/null 2>&1 || true
}
trap cleanup_failed_restore ERR

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass "file:$BACKUP_KEY_FILE" -in "$backup_file" \
  | docker compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
      -U "${POSTGRES_USER:-bhayanakcast}" -d "$target_database"

docker compose exec -T postgres psql -X --set ON_ERROR_STOP=1 \
  -U "${POSTGRES_USER:-bhayanakcast}" -d "$target_database" \
  -c 'SELECT current_database(), count(*) AS restored_tables FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"');'
trap - ERR
printf '%s\n' "$target_database"
