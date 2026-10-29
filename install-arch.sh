#!/usr/bin/env bash
# Install dms-bar-visualizer on Arch Linux as a pacman package, built locally with makepkg from
# packaging/aur/dms-bar-visualizer-git. Run it again to update to the latest commit.
#
#   ./install-arch.sh               build, install and enable autostart
#   ./install-arch.sh --no-service  build and install only; run with: qs -c bar-visualizer
#   ./install-arch.sh --uninstall   stop autostart and remove the package
#
# Without a clone:
#   curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-arch.sh | bash
#   (options go after: ... | bash -s -- --no-service)
set -euo pipefail

PKG="dms-bar-visualizer-git"
NAME="bar-visualizer"
UNIT="$NAME.service"
RAW="https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/packaging/aur/$PKG"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# Empty when piped into bash; the PKGBUILD is downloaded then.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

info() { printf '\033[1;35m::\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
Install dms-bar-visualizer on Arch Linux as a pacman package built locally with makepkg.

  install-arch.sh               build, install and enable autostart
  install-arch.sh --no-service  build and install only; run with: qs -c bar-visualizer
  install-arch.sh --uninstall   stop autostart and remove the package
USAGE
}

has_tty() { { : </dev/tty; } 2>/dev/null; }

# Piped into bash, stdin is the script itself, so prompts (sudo, pacman) must read the terminal.
interactive() {
    if has_tty; then "$@" </dev/tty; else "$@"; fi
}

stop_manual_instances() {
    pkill -f "(^|/)qs -c $NAME\$" 2>/dev/null || true
    pkill -f "^cava -p ${XDG_RUNTIME_DIR:-/run/user/$UID}/$NAME-cava.conf" 2>/dev/null || true
}

uninstall() {
    if systemctl --user is-enabled "$UNIT" &>/dev/null || systemctl --user is-active "$UNIT" &>/dev/null; then
        info "Disabling $UNIT"
        systemctl --user disable --now "$UNIT" 2>/dev/null || true
    fi
    stop_manual_instances
    if pacman -Q "$PKG" &>/dev/null; then
        info "Removing $PKG"
        interactive sudo pacman -R "$PKG"
    fi
    info "Uninstalled. Your settings in $CONFIG_HOME/$NAME were left in place."
}

check_system() {
    ((EUID != 0)) || die "run this as your normal user, not root (makepkg refuses to build as root)"
    command -v pacman >/dev/null || die "pacman not found. This script is for Arch Linux; elsewhere use install.sh"
    # pacman runs through sudo, which needs a terminal to ask for the password.
    has_tty || sudo -n true 2>/dev/null || die "sudo needs a terminal to ask for your password; run this from a terminal"
    local missing=()
    command -v makepkg >/dev/null && command -v fakeroot >/dev/null || missing+=(base-devel)
    command -v git >/dev/null || missing+=(git)
    if ((${#missing[@]})); then
        info "Installing build tools: ${missing[*]}"
        interactive sudo pacman -S --needed "${missing[@]}"
    fi
}

# The source install (install.sh) puts a config link and a unit copy in ~/.config, which would
# shadow the package's files.
remove_source_install() {
    local link="$CONFIG_HOME/quickshell/$NAME" unit="$CONFIG_HOME/systemd/user/$UNIT"
    if [[ -L "$link" ]]; then
        info "Removing $link -> $(readlink "$link") (left over from install.sh)"
        rm "$link"
    elif [[ -e "$link" ]]; then
        info "Note: $link exists and takes precedence over the package. Remove it to use the package."
    fi
    if [[ -f "$unit" ]]; then
        info "Removing $unit (left over from install.sh)"
        systemctl --user disable "$UNIT" 2>/dev/null || true
        rm "$unit"
    fi
}

BUILD_DIR=""
cleanup() { [[ -z "$BUILD_DIR" ]] || rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

build_and_install() {
    BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/$PKG.XXXXXX")"
    local build="$BUILD_DIR"
    if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/packaging/aur/$PKG/PKGBUILD" ]]; then
        cp "$SCRIPT_DIR/packaging/aur/$PKG/PKGBUILD" "$SCRIPT_DIR/packaging/aur/$PKG/$PKG.install" "$build/"
    else
        info "Downloading the PKGBUILD"
        curl -fsSL -o "$build/PKGBUILD" "$RAW/PKGBUILD"
        curl -fsSL -o "$build/$PKG.install" "$RAW/$PKG.install"
    fi
    info "Building $PKG (pacman will ask before installing anything)"
    (cd "$build" && interactive makepkg --syncdeps --install --clean)
}

install_service() {
    systemctl --user daemon-reload
    systemctl --user enable "$UNIT"
    systemctl --user restart "$UNIT"
    info "Enabled $UNIT (starts with your graphical session)"
}

# Nothing runs until bash has read this far, so a download cut off midway does nothing.
main() {
    case "${1:-}" in
        --uninstall) uninstall; exit 0 ;;
        --no-service | "") ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac

    check_system
    build_and_install
    stop_manual_instances
    remove_source_install

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
$CONFIG_HOME/$NAME/config.json (see README).
To update later, run this script again.
EOF
}

main "$@"
