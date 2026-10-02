#!/bin/sh
# Container healthcheck (docker-compose.yml): healthy only while the last run succeeded and is
# recent. A backup that stopped running (a dead schedule, a wedged container) leaves an old "ok",
# so one older than BACKUP_MAX_AGE_HOURS counts as failed. Status file: "ok EPOCH ISO-TIME".
set -eu

status_file=/tmp/backup-status
max_age_hours=${BACKUP_MAX_AGE_HOURS:-26}

case $max_age_hours in
  '' | *[!0-9]* | ?????*)
    echo "healthcheck: BACKUP_MAX_AGE_HOURS must be a whole number of hours, up to 9999: $max_age_hours" >&2
    exit 1
    ;;
esac
# Decimal, not octal: see backup.sh.
max_age_hours=${max_age_hours#"${max_age_hours%%[!0]*}"}
# Nothing left means 0 hours: no run can be that recent.
[ -n "$max_age_hours" ] || exit 1

read -r state epoch _ < "$status_file" || exit 1
[ "$state" = ok ] || exit 1
case $epoch in
  '' | *[!0-9]*) exit 1 ;;
esac

age=$(($(date +%s) - epoch))
if [ "$age" -gt $((max_age_hours * 3600)) ]; then
  echo "healthcheck: last ok backup is $((age / 3600))h old, over the $max_age_hours h allowed" >&2
  exit 1
fi
