#!/usr/bin/env bash
# CARUP-PAY-04-LR01 — dedicated, disposable LOCAL Supabase stack for PAY-04 physical UAT.
#   project carup-pay04-supabase · API 127.0.0.1:56321 · DB 127.0.0.1:56322.
# Never touches the PAY-01C/PAY-03A evidence stack (carup-pay01a-supabase, 54321/54322), the PAY-03B stack
# (carup-pay03b-supabase, 55321/55422), staging or production.
# The Supabase CLI always runs from the stack's own directory under env -i, so it can never resolve a project
# reference from a repository .env (finding F-ENV-1).
set -euo pipefail
readonly STACK_ROOT="${PAY04_STACK_ROOT:-$HOME/carup-pay04-supabase}"
cmd="${1:-status}"
fail() { echo "PAY-04 local stack: $*" >&2; exit 1; }
case "$STACK_ROOT" in *' '*) fail 'stack root must not contain spaces.' ;; esac
[ "$STACK_ROOT" != '/private/tmp/carup-pay01a-supabase' ] || fail 'refusing the PAY-01C/PAY-03A evidence stack.'
[ "$STACK_ROOT" != "$HOME/carup-pay03b-supabase" ] || fail 'refusing the PAY-03B evidence stack.'
cli() { (cd "$STACK_ROOT" && env -i PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" supabase "$@" --workdir "$STACK_ROOT"); }

write_config() {
  mkdir -p "$STACK_ROOT/supabase"
  cat > "$STACK_ROOT/supabase/config.toml" <<'TOML'
project_id = "carup-pay04-supabase"

[api]
enabled = true
port = 56321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 56322
shadow_port = 56320
major_version = 17

[db.pooler]
enabled = false
port = 56329

[db.migrations]
enabled = false

[db.seed]
enabled = false

[realtime]
enabled = false

[studio]
enabled = false
port = 56323

[inbucket]
enabled = false
port = 56324

[storage]
enabled = true
file_size_limit = "15MiB"

[storage.image_transformation]
enabled = false

[auth]
# Enabled only so the CLI issues the stack's local anon/service-role keys (CarUp uses its own session auth).
enabled = true
site_url = "http://127.0.0.1:5203"

[edge_runtime]
enabled = false

[analytics]
enabled = false
port = 56327
TOML
}

case "$cmd" in
  init) [ -f "$STACK_ROOT/supabase/config.toml" ] && echo "config exists: $STACK_ROOT" || { write_config; echo "config written: $STACK_ROOT"; } ;;
  start) [ -f "$STACK_ROOT/supabase/config.toml" ] || write_config; cli start ;;
  status) cli status ;;
  stop) cli stop ;;
  # Disposable reset: drops ONLY this project's data volumes (carup-pay04-supabase), then starts it empty.
  reset)
    grep -q '^project_id = "carup-pay04-supabase"$' "$STACK_ROOT/supabase/config.toml" || fail 'refusing: not the PAY-04 stack config.'
    cli stop --no-backup
    cli start ;;
  *) fail "usage: $0 init|start|status|stop|reset" ;;
esac
