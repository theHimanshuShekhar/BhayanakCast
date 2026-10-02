/**
 * Runs backup.sh and healthcheck.sh inside the backup image against a throwaway Postgres
 * container. Needs Docker; `pnpm test:backup`. Every `docker run` here starts from a fresh image
 * filesystem, so /backups and /nas are plain directories the script sets up for itself.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const image = `bhayanakcast-backup-test:${process.pid}`;
const pg = `bhayanakcast-backup-test-pg-${process.pid}`;

function docker(args: string[], timeout = 120_000): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Run a shell script in the image, sharing the Postgres container's network; returns its output. */
function inImage(script: string, env: Record<string, string> = {}): string {
  const envArgs = Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
  return docker([
    "run",
    "--rm",
    "--network",
    `container:${pg}`,
    ...["PGHOST=127.0.0.1", "PGUSER=postgres", "PGPASSWORD=test", "PGDATABASE=postgres"].flatMap(
      (e) => ["-e", e],
    ),
    ...envArgs,
    "--entrypoint",
    "sh",
    image,
    "-c",
    `exec 2>&1\n${script}`,
  ]);
}

// Shell prelude: a NAS directory with its marker, and a helper for "N days ago" dump dates.
const nas = `
mkdir -p /backups /nas && touch /nas/.bhayanakcast-backups
day() { date -d "@$(( $(date +%s) - $1 * 86400 ))" +%F; }
`;

// A pg_dump / rsync that never finishes. exec, so the timeout's signal reaches the sleep itself.
const stub = (name: string, before = "") => `
mkdir -p /tmp/stub && printf '#!/bin/sh\\n${before}exec sleep 600\\n' > /tmp/stub/${name} && chmod +x /tmp/stub/${name}
`;

beforeAll(() => {
  docker(["build", "-q", "-t", image, fileURLToPath(new URL(".", import.meta.url))], 600_000);
  docker(["run", "-d", "--rm", "--name", pg, "-e", "POSTGRES_PASSWORD=test", "postgres:17-alpine"]);
  for (let i = 0; ; i++) {
    try {
      docker(["exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
      break;
    } catch (err) {
      if (i >= 60) throw err;
      execFileSync("sleep", ["1"]);
    }
  }
  docker([
    "exec",
    pg,
    "psql",
    "-U",
    "postgres",
    "-c",
    "create table widget (name text); insert into widget values ('sprocket-from-test')",
  ]);
}, 600_000);

afterAll(() => {
  for (const args of [
    ["rm", "-f", pg],
    ["rmi", "-f", image],
  ]) {
    try {
      docker(args);
    } catch {
      // Already gone.
    }
  }
});

describe("backup.sh", () => {
  it("dumps, copies to the NAS and writes ok with a timestamp the healthcheck accepts", () => {
    const out = inImage(`${nas}
backup.sh; echo "rc=$?"
cat /tmp/backup-status
ls /backups /nas
gunzip -c /nas/bhayanakcast-$(date +%F).sql.gz | grep -c sprocket-from-test
healthcheck.sh; echo "health=$?"
`);
    expect(out).toContain("rc=0");
    expect(out).toMatch(/^ok \d{10} \d{4}-\d\d-\d\dT\S+$/m);
    expect(out).toMatch(/^bhayanakcast-\d{4}-\d\d-\d\d\.sql\.gz$/m);
    expect(out).toMatch(/^[1-9]\d*$/m);
    expect(out).toContain("health=0");
  });

  it("fails and says so when the NAS marker is missing", () => {
    const out = inImage(`
mkdir -p /backups /nas
backup.sh; echo "rc=$?"
cat /tmp/backup-status
ls /nas | wc -l
ls /backups
`);
    expect(out).toContain("/nas/.bhayanakcast-backups is missing");
    expect(out).toContain("rc=1");
    expect(out).toMatch(/^failed .* exit 1$/m);
    expect(out).toMatch(/^0$/m); // nothing was written to the unmarked directory
    expect(out).toMatch(/^bhayanakcast-\d{4}-\d\d-\d\d\.sql\.gz$/m); // the local copy is kept
  });

  it("times a hung pg_dump out, fails the run and releases the lock", () => {
    const out = inImage(
      `${nas}${stub("pg_dump")}
start=$(date +%s)
PATH=/tmp/stub:$PATH backup.sh; echo "rc=$?"
echo "seconds=$(( $(date +%s) - start ))"
cat /tmp/backup-status
ls /backups
backup.sh; echo "second=$?"
cat /tmp/backup-status
`,
      { BACKUP_DUMP_TIMEOUT: "2" },
    );
    expect(out).toContain("rc=143");
    expect(Number(/seconds=(\d+)/.exec(out)?.[1])).toBeLessThan(30);
    expect(out).toMatch(/^failed .* exit 143$/m);
    expect(out).not.toMatch(/\.partial/);
    expect(out).not.toContain("another run is in progress");
    expect(out).toContain("second=0");
    expect(out).toMatch(/^ok \d+ /m);
  });

  it("times a hung rsync out and removes the temp file it left on the NAS", () => {
    const out = inImage(
      `${nas}${stub("rsync", "touch /nas/.bhayanakcast-2026-01-01.sql.gz.AbC123\\n")}
touch /nas/.keep-me /nas/notes.txt
PATH=/tmp/stub:$PATH backup.sh; echo "rc=$?"
ls -A /nas
`,
      { BACKUP_RSYNC_TIMEOUT: "2" },
    );
    expect(out).toContain("rc=143");
    expect(out).not.toContain("AbC123");
    expect(out).toContain(".keep-me");
    expect(out).toContain("notes.txt");
  });

  it("removes leftover temp files but nothing else", () => {
    const out = inImage(`${nas}
touch /backups/bhayanakcast-2020-01-01.sql.gz.partial /nas/.bhayanakcast-2026-01-01.sql.gz.XyZ789
touch /nas/.keep-me /nas/notes.txt /nas/.other.txt.AbC123
backup.sh; echo "rc=$?"
ls -A /backups /nas
`);
    expect(out).toContain("rc=0");
    expect(out).not.toContain(".partial");
    expect(out).not.toContain("XyZ789");
    expect(out).toContain(".keep-me");
    expect(out).toContain("notes.txt");
    expect(out).toContain(".other.txt.AbC123");
  });

  // Octal would read 014 as 12 days (pruning the 13-day-old dump) and fail on 08.
  it.each([
    ["014", 13, 14],
    ["08", 7, 8],
  ])("reads BACKUP_RETENTION_DAYS=%s as decimal", (days, keptAge, prunedAge) => {
    const out = inImage(
      `${nas}
for d in ${keptAge} ${prunedAge} 40; do
  touch /backups/bhayanakcast-$(day $d).sql.gz /nas/bhayanakcast-$(day $d).sql.gz
done
backup.sh; echo "rc=$?"
for d in ${keptAge} ${prunedAge} 40; do
  for dir in /backups /nas; do
    if [ -e $dir/bhayanakcast-$(day $d).sql.gz ]; then echo "kept $dir $d"; else echo "pruned $dir $d"; fi
  done
done
`,
      { BACKUP_RETENTION_DAYS: days },
    );
    expect(out).toContain("rc=0");
    for (const dir of ["/backups", "/nas"]) {
      expect(out).toContain(`kept ${dir} ${keptAge}`);
      expect(out).toContain(`pruned ${dir} ${prunedAge}`);
      expect(out).toContain(`pruned ${dir} 40`);
    }
  });

  it.each(["0", "000", "abc", "1.5", "123456"])("rejects BACKUP_RETENTION_DAYS=%j", (days) => {
    const out = inImage(`${nas}\nbackup.sh; echo "rc=$?"\ncat /tmp/backup-status`, {
      BACKUP_RETENTION_DAYS: days,
    });
    expect(out).toContain("BACKUP_RETENTION_DAYS must be");
    expect(out).toContain("rc=1");
  });
});

describe("healthcheck.sh", () => {
  // `ok` written N hours ago, then the healthcheck's exit code.
  const check = (hoursAgo: number, env: Record<string, string> = {}) =>
    inImage(
      `echo "ok $(( $(date +%s) - ${hoursAgo} * 3600 )) x" > /tmp/backup-status; healthcheck.sh; echo "health=$?"`,
      env,
    );

  it("passes a recent ok and fails one older than the default 26 hours", () => {
    expect(check(1)).toContain("health=0");
    expect(check(25)).toContain("health=0");
    const stale = check(27);
    expect(stale).toContain("health=1");
    expect(stale).toContain("27h old");
  });

  it("takes the allowed age from BACKUP_MAX_AGE_HOURS, zeros and all", () => {
    expect(check(27, { BACKUP_MAX_AGE_HOURS: "030" })).toContain("health=0");
    expect(check(27, { BACKUP_MAX_AGE_HOURS: "08" })).toContain("health=1");
    expect(check(5, { BACKUP_MAX_AGE_HOURS: "08" })).toContain("health=0");
    expect(check(1, { BACKUP_MAX_AGE_HOURS: "abc" })).toContain("health=1");
  });

  it("fails on a failed run, a missing or malformed status file", () => {
    for (const status of [
      'echo "failed 2026-10-02T03:00:00+00:00 exit 1" > /tmp/backup-status',
      'echo "ok" > /tmp/backup-status',
      "rm -f /tmp/backup-status",
    ]) {
      expect(inImage(`${status}; healthcheck.sh; echo "health=$?"`)).toContain("health=1");
    }
  });
});
