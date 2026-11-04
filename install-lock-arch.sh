#!/usr/bin/env bash
# Install the Lock Ring on Arch Linux as a pacman package, dms-lock-visualizer-git, built locally
# with makepkg from packaging/aur/dms-lock-visualizer-git. It goes into DMS's system plugin dir.
# Run it again to update to the latest commit. Separate from the Bar Visualizer (install-arch.sh):
# neither script touches the other's package.
#
#   ./install-lock-arch.sh              build and install (or update)
#   ./install-lock-arch.sh --uninstall  remove the package
#
# Without a clone:
#   curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-lock-arch.sh | bash
#   (options go after: ... | bash -s -- --uninstall)
set -euo pipefail

PKG="dms-lock-visualizer-git"
PLUGIN_ID="lockRing"
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
Install the Lock Ring on Arch Linux as a pacman package built locally with makepkg.

  install-lock-arch.sh              build and install (or update)
  install-lock-arch.sh --uninstall  remove the package
USAGE
}

has_tty() { { : </dev/tty; } 2>/dev/null; }

# Piped into bash, stdin is the script itself, so prompts (sudo, pacman) must read the terminal.
interactive() {
    if has_tty; then "$@" </dev/tty; else "$@"; fi
}

uninstall() {
    if pacman -Q "$PKG" &>/dev/null; then
        info "Removing $PKG"
        interactive sudo pacman -R "$PKG"
        info "Uninstalled. Restart DMS so it drops the plugin: dms restart"
    else
        info "$PKG isn't installed"
    fi
}

check_system() {
    ((EUID != 0)) || die "run this as your normal user, not root (makepkg refuses to build as root)"
    command -v pacman >/dev/null || die "pacman not found. This script is for Arch Linux; elsewhere use install-lock.sh"
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

# A user plugin shadows the system plugin with the same id, so a link left by install-lock.sh
# would hide the package.
remove_source_install() {
    local link
    for link in "$CONFIG_HOME/dms/plugins/$PLUGIN_ID" "$CONFIG_HOME/DankMaterialShell/plugins/$PLUGIN_ID"; do
        if [[ -L "$link" ]]; then
            info "Removing $link -> $(readlink "$link") (left over from install-lock.sh)"
            rm "$link"
        elif [[ -e "$link" ]]; then
            info "Note: $link exists and takes precedence over the package. Remove it to use the package."
        fi
    done
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

# Nothing runs until bash has read this far, so a download cut off midway does nothing.
main() {
    case "${1:-}" in
        --uninstall) uninstall; exit 0 ;;
        "") ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac

    check_system
    build_and_install
    remove_source_install
    info "Done."

    cat <<EOF

DMS keeps a loaded plugin until it restarts, so after an update (or if the Lock Ring doesn't
show up under DMS Settings -> Plugins), restart it: dms restart
Add it to the lock screen:
  DMS Settings -> Lock Screen -> Add widget -> Lock Ring
Both the ring and DMS's password field start centered: move the password field below the ring.
To update later, run this script again.
EOF
}

main "$@"
