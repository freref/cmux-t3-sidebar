#!/bin/bash
# cmux-t3-sidebar: tells cmux that a Claude Code turn ended when Claude Code
# didn't, and keeps what the sidebar needs to wake a sleeping thread.
#
# cmux shows a Claude session as working from the prompt (or a tool call) until
# Claude Code's Stop hook. Claude Code skips Stop when you interrupt the turn
# (Esc or Ctrl+C, even before the prompt is sent, or by declining a permission
# prompt), so the thread stays "working" (or "Input") until your next prompt.
# Claude Code rewrites its own status file (~/.claude/sessions/<pid>.json) on
# every busy/idle change: this hook watches it, and when Claude is idle while the
# turn it saw start never got a Stop, it sends cmux the Stop it missed. It also
# forwards StopFailure (a turn that died on an API error), which cmux 0.64 does
# not listen for, takes a pane back for its session after a /fork (see
# reclaim), and puts a session cmux forked back on its own pane (see rebind).
#
# cmux knows when Claude is idle with a monitor or other background task still
# running, but doesn't tell custom sidebars. This hook does, through the
# workspace's progress label (see show_background).
#
# The sidebar puts a settled thread's Claude to sleep (it exits it) and starts
# it again when you open the thread, with "claude-turn-end.sh resume <session>".
# cmux drops a session's resume command when Claude exits, so this hook keeps a
# copy (same flags and permission mode) for that.
#
# Setup: see README.md (hooks for SessionStart, UserPromptSubmit, PreToolUse,
# Stop, StopFailure, SessionEnd and FileChanged, each running
# "claude-turn-end.sh <event>").

resume_dir="${XDG_STATE_HOME:-$HOME/.local/state}/cmux-t3/resume"

# Run by the sidebar in the thread's terminal. Without a session id it takes
# the last session this terminal ran (cmux can forget an ended one).
if [ "$1" = resume ]; then
  id="${2:-$(cat "$resume_dir/surface-$CMUX_SURFACE_ID" 2>/dev/null)}"
  saved=$(cat "$resume_dir/$id.sh" 2>/dev/null)
  # Claude Code writes a session's transcript at its first message, so one you
  # never prompted can't be resumed ("No conversation found"). Start it again
  # instead: a fork forks the same session again.
  { read -r transcript; read -r parent; } 2>/dev/null <"$resume_dir/$id.start"
  if [ -n "$id" ] && [ -n "$transcript" ] && [ ! -e "$transcript" ]; then
    again=${parent:+"'--resume' '$parent' '--fork-session'"}
    [[ $saved == *"'--resume' '$id'"* ]] && exec /bin/sh -c "${saved/"'--resume' '$id'"/$again}"
    exec claude ${parent:+--resume "$parent" --fork-session}
  fi
  [ -n "$id" ] && [ -n "$saved" ] && exec /bin/sh -c "$saved"
  [ -n "$id" ] && exec claude --resume "$id"
  exec claude --continue
fi

event="$1"
input="$(cat)"
# Outside cmux (or with its Claude hooks off) there is nothing to correct.
[ -n "$CMUX_SURFACE_ID" ] && [ "$CMUX_CLAUDE_HOOKS_DISABLED" != "1" ] || exit 0
[[ $input =~ \"session_id\":\ *\"([^\"]+)\" ]] || exit 0
session="${BASH_REMATCH[1]}"
turn="${TMPDIR:-/tmp}/cmux-t3-turns/$session"
status_file="$HOME/.claude/sessions/${CMUX_CLAUDE_PID:-$PPID}.json"
# The session cmux takes as this pane's owner: the last one to start in this
# process (see reclaim).
owner_file="${TMPDIR:-/tmp}/cmux-t3-turns/owner-${CMUX_CLAUDE_PID:-$PPID}"
# Set while this session's background work is on the workspace's progress.
background_file="${TMPDIR:-/tmp}/cmux-t3-turns/background-$session"

cmux_cli="${CMUX_CLAUDE_HOOK_CMUX_BIN:-${CMUX_BUNDLED_CLI_PATH:-cmux}}"
cmux() {
  CMUXTERM_CLI_RESPONSE_TIMEOUT_SEC=2 "$cmux_cli" ${CMUX_SOCKET_PATH:+--socket "$CMUX_SOCKET_PATH"} "$@" 2>/dev/null
}
status_is() { [[ $(<"$status_file") =~ \"status\":\ *\"($1)\" ]]; } 2>/dev/null
# "shell" is idle with a background shell task still running.
idle() { status_is 'idle|shell'; }
field() { # field <key> [json]: a string field, escaped for a JSON literal
  local v
  v=$(plutil -extract "$1" raw -o - - <<<"${2:-$input}" 2>/dev/null)
  v=${v//\\/\\\\}
  printf '%s' "${v//\"/\\\"}"
}
# Claude Code's /fork (and a "claude -p" run by a tool) sends cmux a
# SessionStart for a new session from the same process and pane. cmux makes
# it the pane's owner and drops every later hook from the session you keep
# using as stale, so that one stays Working (or idle) for good. cmux accepts
# a /clear SessionStart from any session: send one for the process's own
# session (its status file names it) before its next event.
reclaim() {
  local owner
  owner=$(cat "$owner_file" 2>/dev/null)
  [ -n "$owner" ] && [ "$owner" != "$session" ] || return 0
  [[ $(<"$status_file") =~ \"sessionId\":\ *\"$session\" ]] || return 0
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","source":"clear","hook_event_name":"SessionStart"}' \
    "$session" "$(field transcript_path)" "$(field cwd)" | cmux hooks claude session-start >/dev/null
  printf '%s' "$session" >"$owner_file"
}
# cmux's own fork (Fork Conversation to a new workspace, tab or split) tells
# its agent registry that the forked session now runs in the fork's pane, so
# that session's agent moves there, idle, until its next hook event: its own
# thread drops Working, or its agent altogether. Send the registry the forked
# session's current state from its own pane (cmux's hook store still has it).
rebind() { # rebind <forked session>
  local rec pid surface workspace event
  rec=$(cmux sessions list --agent claude --session "$1" --json)
  pid=$(field sessions.0.pid "$rec") surface=$(field sessions.0.surface_id "$rec")
  workspace=$(field sessions.0.workspace_id "$rec")
  [ -n "$surface" ] && [ "$surface" != "$CMUX_SURFACE_ID" ] && kill -0 "$pid" || return 0
  [[ $(<"$HOME/.claude/sessions/$pid.json") =~ \"sessionId\":\ *\"$1\".*\"status\":\ *\"([a-z]+)\" ]] || return 0
  case ${BASH_REMATCH[1]} in
    busy) event=PostToolUse ;;
    waiting) event=Notification ;;
    idle | shell) event=Stop ;;
    *) return 0 ;;
  esac
  # The feed path only: no notification, Completed or Idle status of its own.
  printf '{"session_id":"%s","hook_event_name":"%s","transcript_path":"%s","cwd":"%s","surface_id":"%s","workspace_id":"%s"}' \
    "$1" "$event" "$(field sessions.0.transcript_path "$rec")" "$(field sessions.0.cwd "$rec")" "$surface" "$workspace" |
    CMUX_CLAUDE_PID=$pid CMUX_SURFACE_ID=$surface CMUX_WORKSPACE_ID=$workspace cmux hooks feed --source claude
}

# cmux's resume binding for this session as one shell line:
#   cd -- '<dir>' && env 'K=V' 'claude' '--resume' '<session>' '--permission-mode' 'auto'
read -r -d '' resume_line_js <<'JS'
function run(argv) {
  const r = JSON.parse(argv[0]).restore_record || {};
  const args = r.prepared_arguments || [];
  if (r.checkpoint_id !== argv[1] || !args.length) return "";
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const env = Object.entries(r.environment || {}).map(([k, v]) => q(k + "=" + v));
  const dir = r.prepared_arguments_working_directory || r.working_directory;
  return (dir ? "cd -- " + q(dir) + " && " : "") + "exec " + (env.length ? "env " + env.join(" ") + " " : "") + args.map(q).join(" ");
}
JS
save_resume() {
  local line
  line=$(osascript -l JavaScript -e "$resume_line_js" "$(cmux surface resume get --json)" "$session" 2>/dev/null)
  [ -n "$line" ] && mkdir -p "$resume_dir" && printf '%s\n' "$line" >"$resume_dir/$session.sh" &&
    printf '%s' "$session" >"$resume_dir/surface-$CMUX_SURFACE_ID"
}

# The background tasks a Stop says still run, as two lines: "shell" when all of
# them are local commands (Claude Code's status file then reads "shell" until
# they end), else "other"; then the sidebar's label:
#   Background: 1 monitor, 2 shells — <what they do>
# The Monitor tool's tasks are shell tasks to Claude Code's hooks, so argv[1]
# lists the ones the transcript shows the Monitor tool started.
# Publishing an artifact arms a "monitor" that waits for its comments, re-armed
# on every resume: it never ends and sleeping loses nothing, so it doesn't count.
read -r -d '' background_js <<'JS'
function run(argv) {
  const artifactWatch = (t) => t.type === "monitor" && /^live updates for artifact /.test(t.description || "");
  const tasks = (JSON.parse(argv[0]).background_tasks || []).filter((t) => t.status === "running" && !artifactWatch(t));
  if (!tasks.length) return "";
  const monitors = (argv[1] || "").split(/\s+/);
  const kind = (t) => (t.type === "shell" && monitors.includes(t.id) ? "monitor" : t.type || "task");
  const counts = {};
  for (const t of tasks) counts[kind(t)] = (counts[kind(t)] || 0) + 1;
  const summary = Object.entries(counts).map(([k, n]) => n + " " + k + (n === 1 ? "" : "s")).join(", ");
  const what = tasks.map((t) => t.description || t.name || t.command || "").filter(Boolean).join(" · ");
  const shell = tasks.every((t) => t.type === "shell");
  return (shell ? "shell" : "other") + "\n" + ("Background: " + summary + (what ? " — " + what : "")).replace(/\s+/g, " ").slice(0, 400);
}
JS
show_background() {
  local out monitors
  # A Monitor tool result reads {"taskId":"<id>",...}; a background command's
  # {"backgroundTaskId":"<id>",...}.
  monitors=$(grep -o -E '"taskId":"[a-z0-9]+"' "$(field transcript_path)" 2>/dev/null | cut -d'"' -f4)
  out=$(osascript -l JavaScript -e "$background_js" "$input" "$monitors" 2>/dev/null)
  [ -n "$out" ] || { clear_background; return; }
  mkdir -p "${background_file%/*}" && printf '%s' "${out%%$'\n'*}" >"$background_file"
  cmux set-progress 0 --label "${out#*$'\n'}" >/dev/null
}
# Only ever clears progress this session set: other tools can use it too.
clear_background() {
  [ -f "$background_file" ] || return 0
  rm -f "$background_file"
  cmux clear-progress >/dev/null
}

case "$event" in
  SessionStart)
    rm -f "$turn"
    clear_background # left over from before a resume: those tasks died with Claude
    mkdir -p "${owner_file%/*}" && printf '%s' "$session" >"$owner_file"
    # Not saved yet (see resume): keep where it will be and, for a fork (which
    # /clear isn't, even in a process started as one), the session it forked.
    if [[ $input =~ \"transcript_path\":\ *\"([^\"]+)\" ]] && [ ! -e "${BASH_REMATCH[1]}" ]; then
      transcript="${BASH_REMATCH[1]}" parent=""
      args=$(ps -ww -o args= -p "${CMUX_CLAUDE_PID:-$PPID}" 2>/dev/null)
      [[ ! $input =~ \"source\":\ *\"clear\" && " $args " == *" --fork-session "* &&
        $args =~ (--resume[=\ ]|-r\ )([0-9a-f-]{36}) ]] && parent="${BASH_REMATCH[2]}"
      mkdir -p "$resume_dir" && printf '%s\n%s\n' "$transcript" "$parent" >"$resume_dir/$session.start"
      [ -n "$parent" ] && { rebind "$parent" >/dev/null 2>&1 & }
    fi
    # cmux publishes the binding a moment after the session starts.
    { sleep 5; save_resume; find "$resume_dir" -type f -mtime +60 -delete; } >/dev/null 2>&1 &
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","watchPaths":["%s"]}}\n' "$status_file"
    ;;
  UserPromptSubmit | PreToolUse)
    reclaim
    # The events that make cmux show "working" open a turn (a tool call opens
    # one for turns Claude starts itself, e.g. after a background task).
    [ -f "$turn" ] || { mkdir -p "${turn%/*}" && printf '%s' "$input" >"$turn"; }
    ;;
  Stop)
    reclaim
    rm -f "$turn"
    show_background
    # cmux refreshes the binding (e.g. a new permission mode) on every Stop.
    { sleep 2; save_resume; } >/dev/null 2>&1 &
    ;;
  SessionEnd)
    rm -f "$turn"
    clear_background
    save_resume # before cmux drops the binding, when it's still there
    ;;
  StopFailure)
    reclaim
    rm -f "$turn"
    # Newer cmux registers StopFailure itself and shows it as an error. cmux
    # 0.64 doesn't know the event, so hand it the Stop this replaces: its
    # notification then reads the API error (last_assistant_message).
    cmux hooks claude inject-settings | grep -q '"StopFailure"' && exit 0
    from='"hook_event_name":"StopFailure"' to='"hook_event_name":"Stop"'
    printf '%s' "${input/$from/$to}" | cmux hooks claude stop >/dev/null
    ;;
  FileChanged)
    # Background commands that ended without a turn of their own (you stopped
    # them): Claude Code's status drops from "shell" to "idle".
    [ "$(cat "$background_file" 2>/dev/null)" = shell ] && status_is idle && clear_background
    # Claude Code runs Stop hooks before it writes "idle", so an open turn here
    # means Stop never came.
    [ -f "$turn" ] && idle || exit 0
    turn_input=$(<"$turn")
    stop=$(printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","hook_event_name":"Stop","stop_hook_active":false}' \
      "$(field session_id "$turn_input")" "$(field transcript_path "$turn_input")" "$(field cwd "$turn_input")")
    # A prompt sent since the check above started a new turn: leave it be.
    # Claim the turn by renaming it, so only one copy of this hook (they can
    # run in parallel) sends the Stop; a plain rm can succeed in both.
    idle && mv "$turn" "$turn.$$" 2>/dev/null || exit 0
    rm -f "$turn.$$"
    reclaim
    # cmux's Stop posts a "Completed" notification (quietly, on the tab you're
    # looking at), shortly after the command returns. You stopped the turn
    # yourself, so take back the one this Stop adds (lines are
    # index:id|workspace|surface|read|title|subtitle|...).
    ours() { cmux list-notifications | grep -F "|$CMUX_SURFACE_ID|" | grep -F "|Completed" | cut -d'|' -f1 | cut -d: -f2; }
    before=$(ours)
    printf '%s' "$stop" | cmux hooks claude stop >/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      for id in $(ours); do
        [[ $before == *"$id"* ]] && continue
        cmux dismiss-notification --id "$id" >/dev/null
        exit 0
      done
      sleep 0.2
    done
    ;;
esac
exit 0
