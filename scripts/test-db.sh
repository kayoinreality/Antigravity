#!/usr/bin/env bash
#
# Runs the Supabase migrations and the sync protocol tests against a throwaway
# Postgres cluster.
#
# This deliberately does not need Docker or the Supabase CLI: those are heavy,
# and the thing under test is plain SQL. `supabase/tests/00_local_shim.sql`
# supplies the few Supabase-provided objects the migrations reference
# (auth.users, auth.uid(), the authenticated role).
#
# Usage:  ./scripts/test-db.sh            # start a cluster, test, tear down
#         PGURL=postgres://…  ./scripts/test-db.sh   # test an existing database

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/antigravity-pgtest}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-/var/tmp}"

# Migrations run quietly: the idempotent drops emit a "does not exist, skipping"
# notice for every policy on a fresh database, which buries anything real.
run_migration() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql "$@" --no-psqlrc --quiet --set ON_ERROR_STOP=1
}

# Tests report each assertion as a notice, so keep those.
run_test() {
  psql "$@" --no-psqlrc --quiet --set ON_ERROR_STOP=1
}

if [[ -n "${PGURL:-}" ]]; then
  PSQL_ARGS=("$PGURL")
else
  if [[ ! -x "$PGBIN/initdb" ]]; then
    echo "Postgres binaries not found at $PGBIN. Set PGBIN or PGURL." >&2
    exit 1
  fi

  # initdb refuses to run as root; use an unprivileged account when we are.
  PG_USER=""
  if [[ "$(id -u)" == "0" ]]; then
    PG_USER="pgtest"
    id -u "$PG_USER" >/dev/null 2>&1 || useradd -M "$PG_USER"
  fi

  as_pg() {
    if [[ -n "$PG_USER" ]]; then
      su "$PG_USER" -c "PATH=$PGBIN:\$PATH $*"
    else
      PATH="$PGBIN:$PATH" bash -c "$*"
    fi
  }

  cleanup() {
    as_pg "pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
    rm -rf "$PGDATA"
  }
  trap cleanup EXIT

  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  [[ -n "$PG_USER" ]] && chown "$PG_USER" "$PGDATA"
  chmod 700 "$PGDATA"

  echo "Starting a temporary Postgres cluster…"
  as_pg "initdb -D $PGDATA -A trust -U postgres" >/dev/null
  as_pg "pg_ctl -D $PGDATA -l $PGDATA/server.log -o '-k $PGHOST -p $PGPORT -c listen_addresses=' -w start" >/dev/null

  PSQL_ARGS=(-h "$PGHOST" -p "$PGPORT" -U postgres -d postgres)
  run_migration "${PSQL_ARGS[@]}" -f "$ROOT/supabase/tests/00_local_shim.sql" >/dev/null
fi

echo "Applying migrations…"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "  $(basename "$migration")"
  run_migration "${PSQL_ARGS[@]}" -f "$migration" >/dev/null
done

echo "Running sync tests…"
run_test "${PSQL_ARGS[@]}" -f "$ROOT/supabase/tests/sync_test.sql" 2>&1 | sed -e 's/^psql:.*NOTICE:  //' -e '/^$/d'
