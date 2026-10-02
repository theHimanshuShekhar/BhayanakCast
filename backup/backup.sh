#!/bin/sh
# shellcheck shell=busybox
# One backup run (ADR 9 addendum): compressed pg_dump to /backups, rsync to the NAS share at
# /nas, and keep the last BACKUP_RETENTION_DAYS days of dumps (today included) in both. The raw data directory is
# never copied. Connection comes from libpq's PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
# The result goes to /tmp/backup-status, which healthcheck.sh reads.
set -eu -o pipefail
# Dumps hold user data and session tokens: owner-only.
umask 077

status_file=/tmp/backup-status
retention_days=${BACKUP_RETENTION_DAYS:-14}
# A hung pg_dump or rsync must fail the run (and so release the lock), not block every later one.
dump_timeout=${BACKUP_DUMP_TIMEOUT:-1800}
rsync_timeout=${BACKUP_RSYNC_TIMEOUT:-1800}
# pg_dump has no connect timeout of its own; libpq reads this one.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}"

# One run at a time: a manual `backup.sh` during the scheduled one would share its .partial file.
# Skipping (not failing) leaves the running backup's result in the status file.
exec 9> /tmp/backup.lock
if ! flock -n 9; then
  echo "backup: another run is in progress; skipping" >&2
  exit 0
fi

# Leftovers of an interrupted run: our .partial dump, and the dot-file rsync writes while copying
# (.NAME.XXXXXX). Only those exact shapes, and only in the NAS directory the marker vouches for,
# so nothing else on the share is touched.
clean_temp() {
  rm -f /backups/*.partial
  if [ -e /nas/.bhayanakcast-backups ]; then
    rm -f /nas/.bhayanakcast-????-??-??.sql.gz.??????
  fi
}

finish() {
  code=$?
  if [ "$code" -eq 0 ]; then
    # "ok EPOCH ISO-TIME": healthcheck.sh compares the epoch, because busybox date can't parse the ISO form.
    echo "ok $(date +%s) $(date -Iseconds)" > "$status_file"
    echo "backup: done"
  else
    clean_temp
    echo "failed $(date -Iseconds) exit $code" > "$status_file"
    echo "backup: FAILED (exit $code)" >&2
    if [ "$code" -eq 143 ] || [ "$code" -eq 137 ]; then
      echo "backup: exit $code means pg_dump or rsync timed out, or the run was killed" >&2
    fi
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
  '' | *[!0-9]*)
    echo "backup: BACKUP_RETENTION_DAYS must be a whole number of days, at least 1: $retention_days" >&2
    exit 1
    ;;
esac
# Shell arithmetic reads a leading 0 as octal (014 is 12, 08 is an error): drop the zeros so the
# number stays decimal. Capped at 5 digits so the date arithmetic below can't overflow.
retention_days=${retention_days#"${retention_days%%[!0]*}"}
case $retention_days in
  '' | ?????*)
    echo "backup: BACKUP_RETENTION_DAYS must be between 1 and 9999 days: ${BACKUP_RETENTION_DAYS:-}" >&2
    exit 1
    ;;
esac
# Oldest day kept: today minus (retention_days - 1). Counted from today's noon so a DST shift
# can't move it by a day.
noon=$(date -d "$(date +%F) 12:00" +%s)
cutoff=$(date -d "@$((noon - (retention_days - 1) * 86400))" +%F)

clean_temp
file=/backups/bhayanakcast-$(date +%F).sql.gz
echo "backup: dumping $PGDATABASE to $file"
# 9>&- keeps the lock out of the children: busybox's `timeout -k` leaves a watcher behind for the
# kill delay, and it would hold the lock after the run has failed.
timeout -k 10 "$dump_timeout" pg_dump --no-owner --no-privileges 9>&- | gzip > "$file.partial"
mv "$file.partial" "$file"
prune /backups

# /nas is the NAS CIFS volume Docker mounts at start (docker-compose.yml). Require a marker file
# that only exists in the intended directory, so a share pointed elsewhere is never written to.
if [ ! -e /nas/.bhayanakcast-backups ]; then
  echo "backup: /nas/.bhayanakcast-backups is missing; is BACKUP_NAS_SHARE the right directory? Dump kept in /backups only." >&2
  exit 1
fi
# --omit-dir-times: setting times on the CIFS mount root can fail. --timeout: give up when the
# share stops answering mid-transfer; the outer timeout bounds the whole copy.
timeout -k 10 "$rsync_timeout" rsync -rt --omit-dir-times --timeout=300 --include='bhayanakcast-*.sql.gz' --exclude='*' /backups/ /nas/ 9>&-
prune /nas
