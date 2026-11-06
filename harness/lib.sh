# shellcheck shell=bash
# What harness/run, harness/record and harness/row share; sourced, not run.

die() { echo "harness: $*" >&2; exit 2; }

# A script's --help: its header comment, from the line after #! to the line before `set `.
show_help() { sed -n '2,/^set /p' "$1" | sed '$d; s/^# \{0,1\}//'; }

# The session's lock (logind's LockedHint): while it's locked the compositor draws none of the run's
# windows, so Qt renders nothing and a run would measure a visualizer that doesn't draw.
session_locked() {
    local id=${XDG_SESSION_ID:-$(loginctl show-user "$(id -u)" -p Display --value 2>/dev/null || true)}
    [[ -n $id && $(loginctl show-session "$id" -p LockedHint --value 2>/dev/null) == yes ]]
}
