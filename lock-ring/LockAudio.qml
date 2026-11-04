pragma Singleton
// The one audio capture every Lock Ring shares, on every monitor, so they all pulse in sync.
// A singleton (listed in qmldir, which is what makes it one instance across DMS's per-screen
// loads) around the shared AudioPipeline. cava runs only while a ring holds it: each ring joins on
// creation (lock) and leaves on destruction (unlock). With no ring left the pipeline is destroyed,
// so nothing captures while unlocked and the next lock starts from silence.
//
//   Component.onCompleted: LockAudio.join(ring)
//   Component.onDestruction: LockAudio.leave(ring)
import QtQuick
import Quickshell
import qs.Common
import "audio"
import "share.mjs" as Share
import "ring.mjs" as Ring
import "docs/kick.mjs" as Kick
import "settings.mjs" as Settings

Singleton {
    id: root

    // --- Inputs -----------------------------------------------------------
    // The Lock Ring's settings (settings.mjs), in real units: one plugin-wide set from DMS's
    // plugin settings, so every ring runs the same kick detector (ADR 0002). DMS replaces
    // pluginSettings on every change, so edits apply live. Never the bar's config.json.
    readonly property var settings: Settings.resolve(SettingsData.pluginSettings[Settings.PLUGIN_ID])

    // --- Outputs ----------------------------------------------------------
    // The look settings, the same for every ring.
    readonly property real intensity: settings.intensity
    readonly property real bassStretch: settings.bassStretch
    readonly property bool running: pipeline !== null
    readonly property int bandCount: Kick.BANDS
    readonly property var values: pipeline?.values ?? new Array(bandCount).fill(0)
    readonly property real bass: pipeline?.bass ?? 0
    readonly property real mid: pipeline?.mid ?? 0
    readonly property real treble: pipeline?.treble ?? 0
    readonly property real time: pipeline?.time ?? 0
    readonly property real flow: pipeline?.flow ?? 0
    // Kicks, for the shockwave and flashing hands: the decaying flash, and the last kickSlots kicks.
    readonly property real kick: pipeline?.kick ?? 0
    readonly property var kickAges: pipeline?.kickAges ?? []
    readonly property var kickPowers: pipeline?.kickPowers ?? []
    readonly property var kickSeeds: pipeline?.kickSeeds ?? []
    readonly property int kickCount: pipeline?.kickCount ?? 0
    // The ring's motion (lock-ring/ring.mjs): radius growth as a fraction of the dial radius, and
    // how strongly the ribbons show (0 = only the faint dial).
    property real swell: 0
    property real presence: 0

    // How many rings hold the capture.
    property int holders: 0

    function join(ring) {
        holders = share.join(ring);
    }

    function leave(ring) {
        holders = share.leave(ring);
    }

    // ----------------------------------------------------------------------

    readonly property var share: Share.createShare()
    readonly property var pipeline: loader.item ?? null
    property var motion: Ring.createRingMotion()

    onRunningChanged: {
        if (running)
            return;
        motion = Ring.createRingMotion();
        swell = 0;
        presence = 0;
    }

    LazyLoader {
        id: loader
        active: root.holders > 0

        // Its own cava conf, not the bar's: each installer stops only its own cava.
        AudioPipeline {
            settings: root.settings
            confPath: `${Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"}/lock-ring-cava.conf`
        }
    }

    FrameAnimation {
        running: root.running
        onTriggered: {
            const m = root.motion.step({ bass: root.bass, mid: root.mid, treble: root.treble }, frameTime);
            root.swell = m.swell;
            root.presence = m.presence;
        }
    }
}
