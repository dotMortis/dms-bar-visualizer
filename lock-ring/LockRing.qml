// The Lock Ring: a DMS desktop plugin placed on the lock screen (Settings -> Lock Screen).
// A clock: a faint ring with 12 hour notches as the dial, three hands that always point at the
// true time (the second hand sweeps), and a small HH:MM below the hub in DMS's lock-screen font
// and 12h/24h setting. The hands show the music too (hands.mjs): hour = bass, minute = mids,
// second = highs, each thickening, glowing and shimmering with its band, never moving off the
// time. Around the dial, spectrum ribbons (shaders/ring.frag) bulge outward with
// the music and the ring swells with its energy; in silence only the faint dial is left. On every
// Kick a chromatic shockwave expands from the hub, sparks fly off the ring and all hands flash.
// Every ring on every monitor draws from the one shared capture in LockAudio.
import QtQuick
import QtQuick.Effects
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
    // Each hand's angle (from the time alone) and look (from its band). The look's parameters, and
    // each hand's band, color and shape, are in hands.mjs.
    readonly property var poses: Hands.handPoses(now, {
        bass: LockAudio.bass,
        mid: LockAudio.mid,
        treble: LockAudio.treble
    })

    // Look settings, at the Bar Visualizer's defaults.
    readonly property real intensity: 1.0
    readonly property real bassStretch: 1.4

    readonly property real size: Math.min(width, height)
    // Leaves room around the dial for the ribbons to bulge into.
    readonly property real dialRadius: size * 0.34

    // Holds the shared capture while this ring exists: from lock to unlock.
    Component.onCompleted: LockAudio.join(root)
    Component.onDestruction: LockAudio.leave(root)

    function quad(arr, i) {
        return Qt.vector4d(arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, arr[i + 3] ?? 0);
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

        // The spectrum ribbons, around and under the dial.
        ShaderEffect {
            anchors.fill: parent
            fragmentShader: Qt.resolvedUrl("shaders/ring.frag.qsb")
            visible: LockAudio.presence > 0.001 || LockAudio.kickSlots.powers.some(p => p > 0)

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

        // Hour, minute, second, in hands.mjs's order, so the second hand draws on top.
        Repeater {
            model: Object.keys(Hands.HANDS)

            Hand {
                required property string modelData
                required property int index
                readonly property var spec: Hands.HANDS[modelData]
                readonly property var pose: root.poses[modelData]

                angle: pose.angle
                length: root.dialRadius * spec.length
                thickness: Math.max(1, root.size * spec.thickness * pose.thicken)
                color: spec.color
                glow: pose.glow
                shimmer: pose.shimmer
                // Each hand's wave at its own offset.
                phase: (LockAudio.time * Hands.LOOK.shimmerSpeed + index / 3) % 1
            }
        }

        // The hub.
        Rectangle {
            anchors.centerIn: parent
            width: root.size * 0.04
            height: width
            radius: width / 2
            color: root.lavender
        }
    }

    // A hand: a rounded ribbon from the center outward, turned clockwise from 12 o'clock by `angle`
    // degrees. Plain in silence; `glow` (0..1) haloes it and `shimmer` (0..1) runs a bright wave
    // along it from the hub to the tip, `phase` (0..1) being where that wave is.
    component Hand: Item {
        id: hand

        property real angle: 0
        property real length: 0
        property real thickness: 0
        property color color: "white"
        property real glow: 0
        property real shimmer: 0
        property real phase: 0

        readonly property color bright: Qt.tint(color, Qt.rgba(1, 1, 1, Hands.LOOK.shimmerWhite * shimmer))
        // Where the bright wave is: 1 = at the hub, 0 = at the tip (the item's top).
        readonly property real waveAt: 1 - phase
        // 0..1: brightens the hand toward white. Every Kick flashes all hands together.
        property real flash: LockAudio.flash

        width: thickness
        height: length
        // In the dial; an inline component can't see the file's ids.
        x: parent.width / 2 - width / 2
        y: parent.height / 2 - height
        transform: Rotation {
            origin.x: hand.width / 2
            origin.y: hand.height
            angle: hand.angle
        }

        // The glow: a wider ribbon in the hand's color, blurred into a soft halo behind the hand.
        // Off (the plain ribbon alone) in silence.
        Rectangle {
            id: halo
            readonly property real pad: hand.thickness * Hands.LOOK.glowSpread / 2
            x: -pad
            y: -pad
            width: hand.width + 2 * pad
            height: hand.height + pad
            radius: width / 2
            color: hand.color
            visible: false
        }
        MultiEffect {
            anchors.fill: halo
            source: halo
            visible: hand.glow > 0.001
            opacity: Hands.LOOK.glowOpacity * hand.glow
            autoPaddingEnabled: true
            blurEnabled: true
            blur: 1
            blurMax: Hands.LOOK.glowBlur
        }

        Rectangle {
            anchors.fill: parent
            radius: width / 2
            antialiasing: true
            color: hand.color
            gradient: hand.shimmer > 0.001 ? shine : null

            Gradient {
                id: shine
                GradientStop { position: 0; color: hand.color }
                GradientStop { position: Math.max(0.001, hand.waveAt - Hands.LOOK.shimmerWidth); color: hand.color }
                GradientStop { position: Math.min(0.998, Math.max(0.002, hand.waveAt)); color: hand.bright }
                GradientStop { position: Math.min(0.999, hand.waveAt + Hands.LOOK.shimmerWidth); color: hand.color }
                GradientStop { position: 1; color: hand.color }
            }
        }

        // The kick flash: a white overlay on top of the hand, glow and shimmer included.
        Rectangle {
            anchors.fill: parent
            radius: width / 2
            antialiasing: true
            color: "white"
            opacity: 0.7 * hand.flash
            visible: opacity > 0.005
        }
    }
}
