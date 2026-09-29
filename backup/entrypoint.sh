#!/bin/sh
# Run one backup now (so a broken setup shows up at deploy time, not the next night), then
# hand over to supercronic, which runs backup.sh on BACKUP_SCHEDULE and logs its output.
set -eu

echo "${BACKUP_SCHEDULE:-0 3 * * *} /usr/local/bin/backup.sh" > /tmp/crontab
supercronic -test /tmp/crontab || {
  echo "BACKUP_SCHEDULE is not a valid cron expression: ${BACKUP_SCHEDULE:-}" >&2
  exit 1
}

/usr/local/bin/backup.sh || true
exec supercronic /tmp/crontab
