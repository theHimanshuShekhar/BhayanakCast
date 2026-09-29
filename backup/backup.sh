#!/bin/sh
# One backup run (ADR 9 addendum): compressed pg_dump to /backups, rsync to the NAS share at
# /nas, and keep the last BACKUP_RETENTION_DAYS days of dumps (today included) in both. The raw data directory is
# never copied. Connection comes from libpq's PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
# The result goes to /tmp/backup-status, which the container healthcheck reads.
set -eu -o pipefail
# Dumps hold user data and session tokens: owner-only.
umask 077

status_file=/tmp/backup-status
retention_days=${BACKUP_RETENTION_DAYS:-14}

# One run at a time: a manual `backup.sh` during the scheduled one would share its .partial file.
# Skipping (not failing) leaves the running backup's result in the status file.
exec 9> /tmp/backup.lock
if ! flock -n 9; then
  echo "backup: another run is in progress; skipping" >&2
  exit 0
fi

finish() {
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "ok $(date -Iseconds)" > "$status_file"
    echo "backup: done"
  else
    rm -f /backups/*.partial
    echo "failed $(date -Iseconds) exit $code" > "$status_file"
    echo "backup: FAILED (exit $code)" >&2
  fi
}
trap finish EXIT

# Dump names carry their date, so pruning goes by name, not by mtime (which CIFS may not keep).
prune() {
  for f in "$1"/bhayanakcast-????-??-??.sql.gz; do
    [ -e "$f" ] || continue
    day=${f##*/bhayanakcast-}
    day=${day%.sql.gz}
    if [ "$day" \< "$cutoff" ]; then
      echo "backup: pruning $f"
      rm -f "$f"
    fi
  done
}

case $retention_days in
  '' | *[!0-9]* | 0)
    echo "backup: BACKUP_RETENTION_DAYS must be a whole number of days, at least 1: $retention_days" >&2
    exit 1
    ;;
esac
# Oldest day kept: today minus (retention_days - 1). Counted from today's noon so a DST shift
# can't move it by a day.
noon=$(date -d "$(date +%F) 12:00" +%s)
cutoff=$(date -d "@$((noon - (retention_days - 1) * 86400))" +%F)

file=/backups/bhayanakcast-$(date +%F).sql.gz
echo "backup: dumping $PGDATABASE to $file"
pg_dump --no-owner --no-privileges | gzip > "$file.partial"
mv "$file.partial" "$file"
prune /backups

# /nas is a bind mount of the host's CIFS mount point. If the share isn't mounted, the mount
# point is an empty local directory, so require a marker file that only exists on the share.
if [ ! -e /nas/.bhayanakcast-backups ]; then
  echo "backup: /nas/.bhayanakcast-backups is missing; is the NAS share mounted? Dump kept in /backups only." >&2
  exit 1
fi
# --omit-dir-times: setting times on the CIFS mount root can fail.
rsync -rt --omit-dir-times --include='bhayanakcast-*.sql.gz' --exclude='*' /backups/ /nas/
prune /nas
