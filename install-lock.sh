#!/usr/bin/env bash
# Install the Lock Ring: link lock-ring/ from this checkout into your DMS plugin dir as lockRing.
# Separate from the Bar Visualizer (install.sh): neither script touches the other's install.
#
#   ./install-lock.sh              install (or point the link at this checkout)
#   ./install-lock.sh --uninstall  remove the link
#
# Then add the widget under DMS Settings -> Lock Screen -> Add widget -> Lock Ring.
set -euo pipefail

PLUGIN_ID="lockRing"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$REPO_DIR/lock-ring"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

info() { printf '\033[1;35m::\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
Install the Lock Ring from this checkout: link lock-ring/ into your DMS plugin dir.

  install-lock.sh              install
  install-lock.sh --uninstall  remove the link
USAGE
}

# DMS 2.x reads ~/.config/dms/plugins. DMS 1.x read ~/.config/DankMaterialShell/plugins; use that
# only when it's the sole DMS config dir there is.
plugin_dir() {
    if [[ ! -d "$CONFIG_HOME/dms" && -d "$CONFIG_HOME/DankMaterialShell" ]]; then
        echo "$CONFIG_HOME/DankMaterialShell/plugins"
    else
        echo "$CONFIG_HOME/dms/plugins"
    fi
}

install() {
    [[ -f "$PLUGIN_SRC/plugin.json" ]] || die "$PLUGIN_SRC/plugin.json not found"
    local dir link
    dir="$(plugin_dir)"
    link="$dir/$PLUGIN_ID"
    mkdir -p "$dir"
    if [[ -L "$link" ]]; then
        rm "$link"
    elif [[ -e "$link" ]]; then
        local backup
        backup="$link.bak-$(date +%Y%m%d-%H%M%S)"
        info "Backing up existing $link to $backup"
        mv "$link" "$backup"
    fi
    ln -s "$PLUGIN_SRC" "$link"
    info "Linked $link -> $PLUGIN_SRC"
    cat <<EOF

DMS picks the plugin up on its own. Add it to the lock screen:
  DMS Settings -> Lock Screen -> Add widget -> Lock Ring
If it doesn't show up, restart DMS: dms restart
EOF
}

# Removes only links: a real lockRing dir (a copy you put there) stays.
uninstall() {
    local removed=0 link
    for link in "$CONFIG_HOME/dms/plugins/$PLUGIN_ID" "$CONFIG_HOME/DankMaterialShell/plugins/$PLUGIN_ID"; do
        if [[ -L "$link" ]]; then
            rm "$link"
            info "Removed $link"
            removed=1
        elif [[ -e "$link" ]]; then
            info "Leaving $link alone: it isn't a link from install-lock.sh"
        fi
    done
    [[ $removed == 1 ]] || info "Nothing to remove"
    return 0
}

case "${1:-}" in
    "") install ;;
    --uninstall) uninstall ;;
    -h | --help) usage ;;
    *) die "unknown option: $1 (see --help)" ;;
esac
