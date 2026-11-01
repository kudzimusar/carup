#!/usr/bin/env bash
# CARUP-PAY-03B-LR01 — dedicated, disposable LOCAL Supabase stack for PAY-03B physical UAT.
#   project carup-pay03b-supabase · API 127.0.0.1:55321 · DB 127.0.0.1:55422 · only db + kong + rest.
# Never touches the PAY-01C/PAY-03A evidence stack (carup-pay01a-supabase, 54321/54322), staging or production.
# The Supabase CLI always runs from the stack's own directory under env -i, so it can never resolve a project
# reference from a repository .env (finding F-ENV-1).
set -euo pipefail
readonly STACK_ROOT="${PAY03B_STACK_ROOT:-$HOME/carup-pay03b-supabase}"
cmd="${1:-status}"
fail() { echo "PAY-03B local stack: $*" >&2; exit 1; }
case "$STACK_ROOT" in *' '*) fail 'stack root must not contain spaces.' ;; esac
[ "$STACK_ROOT" != '/private/tmp/carup-pay01a-supabase' ] || fail 'refusing the PAY-01C/PAY-03A evidence stack.'
cli() { (cd "$STACK_ROOT" && env -i PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" supabase "$@" --workdir "$STACK_ROOT"); }

write_config() {
  mkdir -p "$STACK_ROOT/supabase"
  cat > "$STACK_ROOT/supabase/config.toml" <<'TOML'
project_id = "carup-pay03b-supabase"

[api]
enabled = true
port = 55321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 55422
shadow_port = 55420
major_version = 17

[db.pooler]
enabled = false
port = 55429

[db.migrations]
enabled = false

[db.seed]
enabled = false

[realtime]
enabled = false

[studio]
enabled = false
port = 55423

[inbucket]
enabled = false
port = 55424

[storage]
enabled = true
file_size_limit = "15MiB"

[storage.image_transformation]
enabled = false

[auth]
# Enabled only so the CLI issues the stack's local anon/service-role keys (CarUp uses its own session auth).
enabled = true
site_url = "http://127.0.0.1:5193"

[edge_runtime]
enabled = false

[analytics]
enabled = false
port = 55427
TOML
}

case "$cmd" in
  init) [ -f "$STACK_ROOT/supabase/config.toml" ] && echo "config exists: $STACK_ROOT" || { write_config; echo "config written: $STACK_ROOT"; } ;;
  start) [ -f "$STACK_ROOT/supabase/config.toml" ] || write_config; cli start ;;
  status) cli status ;;
  stop) cli stop ;;
  *) fail "usage: $0 init|start|status|stop" ;;
esac
