# shellcheck shell=bash
# harness/run's stage (--record), sourced by it: a headless Hyprland of its own for the run to show
# on, so a recording holds nothing of the desktop. It has its own runtime dir ($RUN/s, short for its
# sockets' paths), config, cache, state and data dirs and the run's private bus. It starts as a
# client of the desktop's compositor and turns its one window there (its WAYLAND-1 output) off at
# once; it shows on its output STAGE, headless, the size of the desktop's monitor in logical
# pixels (harness/stage.mjs). It never reaches systemd or the user's bus: Hyprland hands its
# environment to `systemctl --user` and `dbus-update-activation-environment` at start, which would
# point the user's services at the stage, so stand-ins for both that do nothing are first on its PATH.
#
# Uses harness/run's RUN, OUT, ID, NODE, HARNESS and DESKTOP_RUNTIME; sets STAGE (its runtime dir)
# and STAGE_SIG (its HYPRLAND_INSTANCE_SIGNATURE). systemd stops its scope, $ID-stage, with the run's.

stage_ctl() { XDG_RUNTIME_DIR=$STAGE HYPRLAND_INSTANCE_SIGNATURE=$STAGE_SIG hyprctl "$@"; }
stage_up() { stage_ctl monitors 2>/dev/null | grep -q '^Monitor STAGE '; }
stage_start() {
    STAGE=$RUN/s
    mkdir -p "$STAGE/bin" "$STAGE/config" "$STAGE/cache" "$STAGE/state" "$STAGE/data"
    chmod 700 "$STAGE"
    ln -s "$DESKTOP_RUNTIME/${WAYLAND_DISPLAY:-wayland-1}" "$STAGE/wayland-host"
    local stub
    for stub in systemctl dbus-update-activation-environment; do
        printf '#!/bin/sh\nexit 0\n' > "$STAGE/bin/$stub"
        chmod +x "$STAGE/bin/$stub"
    done
    XDG_RUNTIME_DIR=$DESKTOP_RUNTIME hyprctl -j monitors > "$RUN/desktop.json" 2>/dev/null || echo '[]' > "$RUN/desktop.json"
    local mode
    mode=$("$NODE" "$HARNESS/stage.mjs" mode "$RUN/desktop.json")
    cat > "$STAGE/stage.lua" <<EOF
hl.monitor({ output = "WAYLAND-1", disabled = true })
hl.monitor({ output = "", mode = "$mode", position = "0x0", scale = 1 })
hl.config({
    misc = { disable_hyprland_logo = true, disable_splash_rendering = true, force_default_wallpaper = 0, background_color = 0x000000 },
    xwayland = { enabled = false },
    ecosystem = { no_update_news = true, no_donation_nag = true },
})
EOF
    systemd-run --user --scope --unit="$ID-stage" -q \
        env -u HYPRLAND_INSTANCE_SIGNATURE -u DISPLAY XDG_RUNTIME_DIR="$STAGE" WAYLAND_DISPLAY=wayland-host \
        XDG_CONFIG_HOME="$STAGE/config" XDG_CACHE_HOME="$STAGE/cache" XDG_STATE_HOME="$STAGE/state" \
        XDG_DATA_HOME="$STAGE/data" PATH="$STAGE/bin:$PATH" \
        Hyprland -c "$STAGE/stage.lua" > "$OUT/stage.log" 2>&1 &
    local sock=""
    for _ in $(seq 100); do
        sock=$(compgen -G "$STAGE/hypr/*/.socket.sock" | head -1 || true)
        [[ -n $sock && -S $STAGE/wayland-1 ]] && break
        sleep 0.1
    done
    [[ -n $sock && -S $STAGE/wayland-1 ]] || die "the stage didn't start (see $OUT/stage.log)"
    STAGE_SIG=$(basename "$(dirname "$sock")")
    stage_ctl output create headless STAGE > /dev/null
    for _ in $(seq 50); do stage_up && break; sleep 0.1; done
    stage_up || die "the stage has no output (see $OUT/stage.log)"
}
