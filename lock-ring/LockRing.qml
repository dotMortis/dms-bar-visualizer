// The Lock Ring: a DMS desktop plugin placed on the lock screen (Settings -> Lock Screen).
// A clock: a faint ring with 12 hour notches as the dial, three hands that always point at the
// true time (the second hand sweeps), and a small HH:MM below the hub in DMS's lock-screen font
// and 12h/24h setting. The hands show the music too (hands.mjs): hour = bass, minute = mids,
// second = highs, each a neon wave ribbon that swings, thickens and glows with its band around a
// straight axis that never moves off the time. Around the dial, spectrum ribbons
// (shaders/ring.frag, which draws the hands too) bulge outward with the music and the ring swells
// with its energy; in silence only the faint dial and plain hands are left. On every Kick a
// chromatic shockwave expands from the hub, sparks fly off the ring and all hands whip and flash.
// Every ring on every monitor draws from the one shared capture in LockAudio.
import QtQuick
import qs.Common
import qs.Modules.Plugins
import "clock.mjs" as Clock
import "hands.mjs" as Hands

DesktopPluginComponent {
    id: root

    // Declared so DMS injects the screen; sizes the default.
    property var screen: null

    // Square, about 40% of the screen height. DMS centers plugin widgets by default.
    readonly property bool forceSquare: true
    readonly property real defaultWidth: Math.round((screen?.height ?? 1080) * 0.4)
    readonly property real defaultHeight: defaultWidth
    minWidth: 160
    minHeight: 160

    // Catppuccin Mocha, as in shaders/viz.frag.
    readonly property color lavender: "#b4befe"

    // Read fresh every frame, so the second hand sweeps and the clock is right again after suspend.
    property var now: new Date()
    // Each hand's angle (from the time alone) and look (from its band, the kick flash and the
    // handWaves setting). The look's parameters, and each hand's band, color and shape, are in
    // hands.mjs; ring.frag draws them.
    readonly property var poses: Hands.handPoses(now, {
        bass: LockAudio.bass,
        mid: LockAudio.mid,
        treble: LockAudio.treble
    }, {
        flash: LockAudio.flash,
        strength: LockAudio.handWaves
    })

    // Look settings, shared by every ring (LockAudio, settings.mjs).
    readonly property real intensity: LockAudio.intensity
    readonly property real bassStretch: LockAudio.bassStretch

    readonly property real size: Math.min(width, height)
    // Leaves room around the dial for the ribbons to bulge into.
    readonly property real dialRadius: size * 0.34

    // Holds the shared capture while this ring exists: from lock to unlock.
    Component.onCompleted: LockAudio.join(root)
    Component.onDestruction: LockAudio.leave(root)

    function quad(arr, i) {
        return Qt.vector4d(arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, arr[i + 3] ?? 0);
    }

    // One pose value of every hand, as the shader's hour/minute/second vec4.
    function perHand(key, scale) {
        const p = root.poses;
        return Qt.vector4d(p.hour[key] * scale, p.minute[key] * scale, p.second[key] * scale, 0);
    }

    FrameAnimation {
        running: root.visible
        onTriggered: root.now = new Date()
    }

    Item {
        id: dial
        width: root.size
        height: root.size
        anchors.centerIn: parent

        // The spectrum ribbons, around and under the dial, and the hands. Always on: it draws the
        // hands even in silence.
        ShaderEffect {
            anchors.fill: parent
            fragmentShader: Qt.resolvedUrl("shaders/ring.frag.qsb")

            // The hands (hands.mjs handPoses()): angles in radians, sizes in dial radii.
            property real pixel: 1 / root.dialRadius
            property real handFlash: LockAudio.flash
            property vector4d handAngle: root.perHand("angle", Math.PI / 180)
            property vector4d handLength: root.perHand("length", 1)
            property vector4d handAmp: root.perHand("amplitude", 1)
            property vector4d handWidth: root.perHand("width", 1)
            property vector4d handGlow: root.perHand("glow", 1)

            // Wrapped for 32-bit precision; 1200 s keeps the hue cycle (t*0.05) seamless.
            property real time: LockAudio.time % 1200
            property real flow: LockAudio.flow
            property real treble: LockAudio.treble
            property real swell: LockAudio.swell
            property real presence: LockAudio.presence
            property real dial: root.dialRadius / (root.size / 2)
            property real intensity: root.intensity
            property real bassStretch: root.bassStretch
            property vector4d kickAge0: root.quad(LockAudio.kickSlots.ages, 0)
            property vector4d kickAge1: root.quad(LockAudio.kickSlots.ages, 4)
            property vector4d kickPower0: root.quad(LockAudio.kickSlots.powers, 0)
            property vector4d kickPower1: root.quad(LockAudio.kickSlots.powers, 4)
            property vector4d kickSeed0: root.quad(LockAudio.kickSlots.seeds, 0)
            property vector4d kickSeed1: root.quad(LockAudio.kickSlots.seeds, 4)
            property vector4d b0: root.quad(LockAudio.values, 0)
            property vector4d b1: root.quad(LockAudio.values, 4)
            property vector4d b2: root.quad(LockAudio.values, 8)
            property vector4d b3: root.quad(LockAudio.values, 12)
            property vector4d b4: root.quad(LockAudio.values, 16)
            property vector4d b5: root.quad(LockAudio.values, 20)
            property vector4d b6: root.quad(LockAudio.values, 24)
            property vector4d b7: root.quad(LockAudio.values, 28)
        }

        // The dial: a thin, faint ring, no face.
        Rectangle {
            anchors.centerIn: parent
            width: root.dialRadius * 2
            height: width
            radius: width / 2
            color: "transparent"
            border.width: Math.max(1, root.size * 0.004)
            border.color: Qt.alpha(root.lavender, 0.22)
        }

        // 12 hour notches across the ring, slightly brighter than it.
        Repeater {
            model: 12

            Rectangle {
                id: notch

                required property int index

                width: Math.max(1.5, root.size * 0.008)
                height: root.size * 0.035
                radius: width / 2
                color: Qt.alpha(root.lavender, 0.5)
                x: dial.width / 2 - width / 2
                y: dial.height / 2 - root.dialRadius - height / 2
                transform: Rotation {
                    origin.x: notch.width / 2
                    origin.y: root.dialRadius + notch.height / 2
                    angle: notch.index * 30
                }
            }
        }

        // The digital time, inside the dial below the hub.
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            y: dial.height / 2 + root.dialRadius * 0.38
            text: Clock.formatTime(root.now, {
                use24Hour: SettingsData.use24HourClock,
                padHours12Hour: SettingsData.padHours12Hour
            })
            color: Qt.alpha(root.lavender, 0.85)
            font.family: SettingsData.lockScreenFontFamily !== "" ? SettingsData.lockScreenFontFamily : Theme.fontFamily
            font.pixelSize: Math.max(10, root.size * 0.075)
            font.weight: Font.Medium
        }

        // The hub.
        Rectangle {
            anchors.centerIn: parent
            width: root.size * 0.028
            height: width
            radius: width / 2
            color: root.lavender
        }
    }
}
