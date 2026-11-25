#!/usr/bin/env bash
# Regenerates db/schema.sql from the local database (ADR 0005). Run after `npm run db:reset`.
set -euo pipefail
cd "$(dirname "$0")/../.."
header=$(sed -n '1,/^-- END HEADER$/p' db/schema.sql)
container=$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)
{
  printf '%s\n' "$header"
  docker exec "$container" pg_dump -U postgres --schema-only --no-owner --no-privileges --schema=public postgres \
    | grep -v '^\\restrict\|^\\unrestrict'
} > db/schema.sql.tmp
mv db/schema.sql.tmp db/schema.sql
