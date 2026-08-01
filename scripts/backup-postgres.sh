#!/usr/bin/env bash
set -euo pipefail

umask 077
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

: "${BACKUP_NAS_MOUNT:?Set BACKUP_NAS_MOUNT to the mounted NAS filesystem}"
: "${BACKUP_DIRECTORY:?Set BACKUP_DIRECTORY below BACKUP_NAS_MOUNT}"
: "${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to a root-readable passphrase file outside the repository}"

if ! mountpoint -q -- "$BACKUP_NAS_MOUNT"; then
  printf 'NAS mount is not mounted: %s\n' "$BACKUP_NAS_MOUNT" >&2
  exit 1
fi
nas_mount="$(realpath -- "$BACKUP_NAS_MOUNT")"
mkdir -p -- "$BACKUP_DIRECTORY"
backup_directory="$(realpath -- "$BACKUP_DIRECTORY")"
case "$backup_directory/" in
  "$nas_mount/"*) ;;
  *) printf 'BACKUP_DIRECTORY must be below BACKUP_NAS_MOUNT\n' >&2; exit 1 ;;
esac
if [[ ! -r "$BACKUP_KEY_FILE" ]]; then
  printf 'Backup key is not readable: %s\n' "$BACKUP_KEY_FILE" >&2
  exit 1
fi
if (( $(wc -c < "$BACKUP_KEY_FILE") < 32 )); then
  printf 'Backup key must contain at least 32 bytes\n' >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_directory/bhayanakcast-postgres-$stamp.dump.enc"
temporary="$(mktemp --tmpdir="$backup_directory" .backup.XXXXXXXX)"
trap 'rm -f -- "$temporary"' EXIT

docker compose exec -T postgres \
  sh -eu -c 'exec pg_dump --format=custom --compress=9 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 \
      -pass "file:$BACKUP_KEY_FILE" -out "$temporary"

test -s "$temporary"
mv -- "$temporary" "$final"
sha256sum "$final" > "$final.sha256"
find "$backup_directory" -maxdepth 1 -type f \
  \( -name 'bhayanakcast-postgres-*.dump.enc' -o -name 'bhayanakcast-postgres-*.dump.enc.sha256' \) \
  -mmin +43200 -delete
trap - EXIT
printf '%s\n' "$final"
