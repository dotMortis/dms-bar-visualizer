# shellcheck shell=bash
# What harness/run, harness/record and harness/row share; sourced, not run.

die() { echo "harness: $*" >&2; exit 2; }

# A script's --help: its header comment, from the line after #! to the line before `set `.
show_help() { sed -n '2,/^set /p' "$1" | sed '$d; s/^# \{0,1\}//'; }
