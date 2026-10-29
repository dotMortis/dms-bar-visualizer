#!/usr/bin/env bash
# Install dms-bar-visualizer: compile the shader, link the Quickshell config, and (optionally)
# enable a systemd user service so it starts with the graphical session.
#
#   ./install.sh               install + enable autostart
#   ./install.sh --no-service  install only; run manually with: qs -c bar-visualizer
#   ./install.sh --uninstall   stop autostart and remove the config link
#
# Without a clone (checks the repo out to ~/.local/share/dms-bar-visualizer, or updates it there):
#   curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install.sh | bash
#   (options go after: ... | bash -s -- --no-service)
set -euo pipefail

NAME="bar-visualizer"
REPO_URL="https://github.com/dotMortis/dms-bar-visualizer.git"
CLONE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dms-bar-visualizer"
CONFIG_LINK="${XDG_CONFIG_HOME:-$HOME/.config}/quickshell/$NAME"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$NAME.service"

# Empty when piped into bash; main() then fetches the repo first.
REPO_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

info() { printf '\033[1;35m::\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
Install dms-bar-visualizer from source: compile the shader, link the Quickshell config,
and enable a systemd user service.

  install.sh               install + enable autostart
  install.sh --no-service  install only; run manually with: qs -c bar-visualizer
  install.sh --uninstall   stop autostart and remove the config link
USAGE
}

# Piped into bash there's no checkout to link, so clone (or update) one and run its install.sh.
bootstrap() {
    command -v git >/dev/null || die "git is required (on Arch: sudo pacman -S git)"
    if [[ -d "$CLONE_DIR/.git" ]]; then
        info "Updating $CLONE_DIR"
        git -C "$CLONE_DIR" pull --ff-only --quiet
    elif [[ -e "$CLONE_DIR" ]]; then
        die "$CLONE_DIR exists but isn't a git checkout; move it away and try again"
    else
        info "Cloning into $CLONE_DIR"
        git clone --quiet "$REPO_URL" "$CLONE_DIR"
    fi
    exec bash "$CLONE_DIR/install.sh" "$@"
}

stop_manual_instances() {
    pkill -f "^qs -c $NAME\$" 2>/dev/null || true
    pkill -f "^cava -p ${XDG_RUNTIME_DIR:-/run/user/$UID}/$NAME-cava.conf" 2>/dev/null || true
}

uninstall() {
    if systemctl --user list-unit-files "$UNIT" &>/dev/null; then
        info "Disabling $UNIT"
        systemctl --user disable --now "$UNIT" 2>/dev/null || true
        rm -f "$UNIT_DIR/$UNIT"
        systemctl --user daemon-reload
    fi
    stop_manual_instances
    if [[ -L "$CONFIG_LINK" ]]; then
        info "Removing $CONFIG_LINK"
        rm "$CONFIG_LINK"
    fi
    info "Uninstalled. The repo itself was left in place ($REPO_DIR)."
}

find_qsb() {
    command -v qsb 2>/dev/null && return
    for p in /usr/lib/qt6/bin/qsb /usr/lib64/qt6/bin/qsb /usr/libexec/qt6/qsb; do
        [[ -x "$p" ]] && { echo "$p"; return; }
    done
    return 1
}

check_deps() {
    local missing=()
    command -v qs >/dev/null || missing+=("quickshell")
    command -v cava >/dev/null || missing+=("cava")
    command -v pactl >/dev/null || missing+=("libpulse (pactl)")
    find_qsb >/dev/null || missing+=("qt6-shadertools (qsb)")
    if ((${#missing[@]})); then
        die "missing dependencies: ${missing[*]}
       On Arch: sudo pacman -S --needed quickshell cava libpulse qt6-shadertools"
    fi
}

compile_shader() {
    local qsb
    qsb="$(find_qsb)"
    info "Compiling shader"
    "$qsb" --glsl "100 es,120,150" --hlsl 50 --msl 12 \
        -o "$REPO_DIR/shaders/viz.frag.qsb" "$REPO_DIR/shaders/viz.frag"
}

link_config() {
    mkdir -p "$(dirname "$CONFIG_LINK")"
    if [[ -L "$CONFIG_LINK" ]]; then
        rm "$CONFIG_LINK"
    elif [[ -e "$CONFIG_LINK" ]]; then
        local backup
        backup="$CONFIG_LINK.bak-$(date +%Y%m%d-%H%M%S)"
        info "Backing up existing $CONFIG_LINK to $backup"
        mv "$CONFIG_LINK" "$backup"
    fi
    ln -s "$REPO_DIR" "$CONFIG_LINK"
    info "Linked $CONFIG_LINK -> $REPO_DIR"
}

install_service() {
    mkdir -p "$UNIT_DIR"
    cp "$REPO_DIR/systemd/$UNIT" "$UNIT_DIR/$UNIT"
    systemctl --user daemon-reload
    systemctl --user enable "$UNIT"
    systemctl --user restart "$UNIT"
    info "Enabled $UNIT (starts with your graphical session)"
}

# Nothing runs until bash has read this far, so a download cut off midway does nothing.
main() {
    case "${1:-}" in
        --uninstall | --no-service | "") ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    [[ -n "$REPO_DIR" ]] || bootstrap "$@"
    if [[ "${1:-}" == "--uninstall" ]]; then
        uninstall
        exit 0
    fi

    check_deps
    compile_shader
    # Running instances may point at an old config; the service (or the user) starts a fresh one.
    stop_manual_instances
    link_config

    if [[ "${1:-}" == "--no-service" ]]; then
        info "Done. Start it with: qs -c $NAME"
    else
        install_service
        info "Done."
    fi

    cat <<EOF

Make sure your DankBar background is transparent:
  DMS Settings -> Dank Bar -> Transparency = 0
If the visualizer doesn't line up with the bar, set barThickness / spacing / radius in
${XDG_CONFIG_HOME:-$HOME/.config}/bar-visualizer/config.json (see README).
EOF
}

main "$@"
