# shellcheck shell=bash
# What harness/run and harness/check-kicks share: a run of qs on the replayed input, apart from the
# desktop. Sourced after lib.sh, not run; nothing happens until a function is called, in this order:
#
#   setup_init        ID, RUN (the run's runtime dir), OUT, NODE, QS_CGROUP; stops everything on exit
#   setup_scenario S  the scenario's input (harness/scenarios.mjs)
#   setup_tree [REV]  TREE (the code under test), REV, TREE_DESC, DIRTY
#   setup_env         the run's own runtime, config, cache, state and data dirs, bin/ (the fake cava
#                     and pactl) first on PATH, the stand-ins' env; needs DMS_SOCKET (1: the stand-in
#                     DMS socket runs, for a scenario with DMS)
#   setup_epoch W N   HARNESS_EPOCH (the track's first frame, W s from now) and WINDOW (N loops)
#   setup_bus         the private session bus with the stand-ins on it, in its scope ($ID-bus)
#   setup_show DIR    the compositor qs shows on, linked from the runtime dir DIR
#   start_qs DIR      qs on the shell in DIR, in its scope ($ID-qs), logging to $OUT/qs.log; LOAD
#   end_inputs        at the window's end: CAPTURE_ALIVE, PLAYER_ALIVE
#   stop_run          stops qs and the bus
#
# then report_head, report_capture and report_player print the report's first lines.
# A command may define cleanup_more, called on exit before the run's dir goes.

setup_init() {
    ID=bvh-$$
    # Short: the Wayland socket's path in it must fit in 108 bytes.
    RUN=$(mktemp -d /tmp/bvh.XXXXXX)
    OUT=${OUT:-$(mktemp -d /tmp/bvh-out.XXXXXX)}
    mkdir -p "$OUT"
    DMS_LOG=$OUT/dms.log
    trap cleanup EXIT
    trap 'exit 130' INT TERM
    # systemd-run --user --scope puts the scopes here.
    QS_CGROUP=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$ID-qs.scope
    # The real node, not a version manager's shim: those read the user's config dirs, which the run swaps.
    NODE=$(node -p process.execPath)
    DESKTOP_RUNTIME=/run/user/$(id -u)
}
cleanup() {
    local u
    # One at a time: systemctl stops none of them if one isn't loaded (not started, or gone).
    for u in qs rec stage bus; do systemctl --user stop "$ID-$u.scope" 2>/dev/null || true; done
    wait "${QS_JOB:-}" 2>/dev/null || true   # perf, when it wraps qs
    if declare -F cleanup_more > /dev/null; then cleanup_more; fi
    rm -rf "$RUN"
}

# The scenario's input (harness/scenarios.mjs, the one list of them): REFERENCE, LOOP_LENGTH,
# FIXTURE (the band stream) or SILENT=1 (cava's silence instead), TRACK (its name in the report),
# PLAYER (the stand-in Active Player's PlaybackStatus at start, or none) with PLAYER_TITLE, and DMS=1
# for a stand-in for DMS's lyrics (the timed lyrics, harness/lyrics.json, for the reference track only).
setup_scenario() {
    SCENARIO=$1
    local input key value
    input=$("$NODE" "$HARNESS/scenarios.mjs" "$SCENARIO") || exit 2
    while IFS='=' read -r key value; do printf -v "$key" '%s' "$value"; done <<< "$input"
    [[ -n ${LOOP_LENGTH:-} ]] || die "couldn't read the scenario from harness/scenarios.mjs"
}

# The code under test: this working tree, or REV exported from git (nothing in the checkout changes).
setup_tree() {
    if [[ -n ${1:-} ]]; then
        REV=$(git -C "$REPO" rev-parse --verify "$1^{commit}") || die "no commit $1"
        TREE=$RUN/tree
        mkdir -p "$TREE"
        git -C "$REPO" archive "$REV" | tar -x -C "$TREE"
        TREE_DESC="$(git -C "$REPO" describe --tags --always "$REV") ($REV)"
        DIRTY=false
    else
        TREE=$REPO
        REV=$(git -C "$REPO" rev-parse HEAD)
        TREE_DESC="working tree at $(git -C "$REPO" describe --tags --always --dirty)"
        # Changes not in REV: harness/table.mjs keeps such runs apart from REV's own.
        DIRTY=false
        [[ $TREE_DESC != *-dirty ]] || DIRTY=true
    fi
}

# The run's own runtime dir, linking back only to PipeWire, systemd and (before qs starts,
# setup_show) the compositor. Pulse is reached by its socket: pactl refuses a symlinked pulse/ dir.
setup_env() {
    local f
    for f in pipewire-0 systemd; do
        [[ -e $DESKTOP_RUNTIME/$f ]] && ln -s "$DESKTOP_RUNTIME/$f" "$RUN/$f"
    done
    chmod 700 "$RUN"
    mkdir -p "$RUN/config/bar-visualizer" "$RUN/cache" "$RUN/state" "$RUN/data"
    echo '{}' > "$RUN/config/bar-visualizer/config.json"   # every setting at its default

    HARNESS_PACTL=$(command -v pactl || true)   # the real one, before bin/ goes first on PATH
    export HARNESS_PACTL XDG_RUNTIME_DIR=$RUN XDG_CONFIG_HOME=$RUN/config XDG_CACHE_HOME=$RUN/cache \
        XDG_STATE_HOME=$RUN/state XDG_DATA_HOME=$RUN/data \
        PULSE_SERVER=unix:$DESKTOP_RUNTIME/pulse/native PATH=$HARNESS/bin:$PATH NO_AT_BRIDGE=1 \
        HARNESS_TREE=$TREE HARNESS_FIXTURE=$FIXTURE HARNESS_SILENT=$SILENT HARNESS_LOOP=$LOOP_LENGTH \
        HARNESS_LOG=$OUT/capture.log \
        HARNESS_PLAYER=$PLAYER HARNESS_PLAYER_TITLE=$PLAYER_TITLE HARNESS_PLAYER_LOG=$OUT/player.log \
        HARNESS_DMS=$DMS_SOCKET HARNESS_DMS_LOG=$DMS_LOG HARNESS_LYRICS=$HARNESS/lyrics.json \
        HARNESS_REFERENCE=$HARNESS/reference.json
    : > "$HARNESS_LOG"
    : > "$HARNESS_PLAYER_LOG"
    : > "$HARNESS_DMS_LOG"
}

# The epoch: the track is at its first frame when the window opens, so every window holds the
# same whole loops; the warm-up plays the track's end.
now() { date +%s.%N; }
sleep_until() { local s; s=$(awk -v t="$1" -v n="$(now)" 'BEGIN { d = t - n; print (d > 0 ? d : 0) }'); sleep "$s"; }
setup_epoch() {
    WARMUP=$1 LOOPS=$2
    HARNESS_EPOCH=$(awk -v n="$(now)" -v w="$WARMUP" 'BEGIN { printf "%.6f", n + w }')
    export HARNESS_EPOCH
    WINDOW=$(awk -v l="$LOOP_LENGTH" -v n="$LOOPS" 'BEGIN { printf "%.6f", l * n }')
}
window_end() { awk -v e="$HARNESS_EPOCH" -v w="$WINDOW" 'BEGIN { printf "%.6f", e + w }'; }

# A private session bus, held open in its own scope ($ID-bus) with the stand-ins on it. They stand
# in for the user's session (the stand-in player for Spotify, say, and the stand-in DMS for DMS), so
# their CPU isn't the visualizer's.
player_on_bus() { busctl --address="$DBUS_SESSION_BUS_ADDRESS" list --no-legend 2>/dev/null | grep -q '^org\.mpris\.MediaPlayer2\.harness '; }
# The bar looks for DMS's socket once at start, then only every 15 s: it must be there before qs.
dms_up() { compgen -G "$RUN/dms-*.sock" >/dev/null; }
setup_bus() {
    systemd-run --user --scope --unit="$ID-bus" -q \
        dbus-run-session --config-file="$HARNESS/bus.conf" -- \
        sh -c 'echo "$DBUS_SESSION_BUS_ADDRESS" > "$XDG_RUNTIME_DIR/bus.addr"
               [ "$HARNESS_PLAYER" = none ] || "$0/player" &
               [ "$HARNESS_DMS" = 0 ] || "$0/dms" &
               exec sleep infinity' "$HARNESS" \
        > "$OUT/bus.log" 2>&1 &
    for _ in $(seq 50); do [[ -s $RUN/bus.addr ]] && break; sleep 0.1; done
    [[ -s $RUN/bus.addr ]] || die "the private session bus didn't start (see $OUT/bus.log)"
    DBUS_SESSION_BUS_ADDRESS=$(cat "$RUN/bus.addr")
    export DBUS_SESSION_BUS_ADDRESS
    if [[ $PLAYER != none ]]; then
        for _ in $(seq 50); do player_on_bus && break; sleep 0.1; done
        player_on_bus || die "the stand-in player didn't start (see $OUT/bus.log)"
    fi
    if ((DMS_SOCKET)); then
        for _ in $(seq 50); do dms_up && break; sleep 0.1; done
        dms_up || die "the stand-in DMS didn't start (see $OUT/bus.log)"
    fi
}

# The compositor qs connects to: the desktop's ($DESKTOP_RUNTIME) or harness/run's stage.
setup_show() {
    local f
    for f in "${WAYLAND_DISPLAY:-wayland-1}" hypr; do
        [[ -e $1/$f ]] && ln -s "$1/$f" "$RUN/$f"
    done
}

# qs in a transient systemd scope, so the scope's cgroup holds qs, its capture and every
# short-lived child (sh, pactl). QS_WRAP, if set, runs in front of it (perf).
start_qs() {
    "${QS_WRAP[@]}" systemd-run --user --scope --unit="$ID-qs" -q qs -p "$1" --no-color --log-times > "$OUT/qs.log" 2>&1 &
    QS_JOB=$!
    LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
}
pids() { cat "$QS_CGROUP/cgroup.procs" 2>/dev/null; }
# A short-lived child (sh, pactl) can exit while it's read: then empty, not a failed run (set -e,
# pipefail).
comm() { cat "/proc/$1/comm" 2>/dev/null || true; }

end_inputs() {
    local p
    CAPTURE_ALIVE=0
    for p in $(pids); do [[ $(comm "$p") != cava ]] || CAPTURE_ALIVE=1; done
    PLAYER_ALIVE=0
    [[ $PLAYER == none ]] || ! player_on_bus || PLAYER_ALIVE=1
}
stop_run() { systemctl --user stop "$ID-qs.scope" "$ID-bus.scope" 2>/dev/null || true; }

# The report's first lines: what ran on what, and that the inputs reached it.
report_head() {
    echo "harness  $1, $TREE_DESC"
    echo "window   $LOOPS x $TRACK ($WINDOW s) after a ${WARMUP} s warm-up, load avg $LOAD"
}
# The capture runs only while the Active Player plays (#54): with none, or a paused one, it not
# running is right (a commit from before #54 captures anyway, which is reported, not failed).
report_capture() {
    STARTS=$(grep -cs '^start' "$HARNESS_LOG" || true); STARTS=${STARTS:-0}
    if [[ $PLAYER != Playing ]]; then
        echo "capture  $( ((CAPTURE_ALIVE)) && echo alive || echo "not running"), started $STARTS time(s) (no playing player)"
        return
    fi
    ((CAPTURE_ALIVE)) || { echo "FAILED: the capture wasn't running at the end of the window (see $OUT/capture.log, $OUT/qs.log)"; exit 1; }
    echo "capture  alive, started $STARTS time(s)$( ((SILENT)) && echo ", silent")"
}
# The stand-in is the only player on the run's bus, so the visualizer reading it means it's the
# Active Player (AudioPipeline.updateActivePlayer takes the only player there is).
report_player() {
    if [[ $PLAYER == none ]]; then
        echo "player   none"
        return
    fi
    local reads
    reads=$(grep -c ' Get' "$HARNESS_PLAYER_LOG" || true)
    ((PLAYER_ALIVE)) || { echo "FAILED: the stand-in player wasn't on the bus at the end of the window (see $OUT/bus.log)"; exit 1; }
    ((reads)) || { echo "FAILED: the visualizer never read the stand-in player (see $OUT/player.log, $OUT/qs.log)"; exit 1; }
    echo "player   $PLAYER \"$PLAYER_TITLE\", the Active Player (read $reads time(s))"
}
