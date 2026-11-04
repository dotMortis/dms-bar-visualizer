// The Lock Ring: a DMS desktop plugin placed on the lock screen (Settings -> Lock Screen).
// A clock: a living neon ribbon as the dial with 12 hour points riding on it, three floating hands
// that always point at the true time (the second hand sweeps), and a small HH:MM below the center
// in DMS's lock-screen font and 12h/24h setting. The hands show the music too (hands.mjs): hour =
// bass, minute = mids, second = highs, each a neon wave ribbon that swings, thickens and glows
// with its band (measured against that band's own recent peak) around a straight axis that never
// moves off the time. The ribbon (ring.mjs) idles
// in silence as a thin, faint, breathing wave; music grows it into spectrum ribbons that wave
// around the swelling dial, and the ring swells with its energy. shaders/ring.frag draws all of that. On every
// Kick a chromatic shockwave expands from the center, sparks fly off the ring and all hands whip
// and flash; as its front crosses the digital time, the time splits into the shockwave's colors
// and glows.
// Every ring on every monitor draws from the one shared capture in LockAudio.
import QtQuick
import QtQuick.Effects
import qs.Common
import qs.Modules.Plugins
import "clock.mjs" as Clock
import "hands.mjs" as Hands
import "ring.mjs" as Ring

DesktopPluginComponent {
    id: root

    // Declared so DMS injects the screen; sizes the default.
    property var screen: null

    // Square, the ring size setting's share of the screen height (40% by default), live. DMS uses
    // it until the widget is resized, and centers plugin widgets by default.
    readonly property bool forceSquare: true
    readonly property real defaultWidth: Math.round((screen?.height ?? 1080) * LockAudio.ringSize)
    readonly property real defaultHeight: defaultWidth
    minWidth: 160
    minHeight: 160

    // Catppuccin Mocha, as in shaders/viz.frag.
    readonly property color lavender: "#b4befe"

    // Read fresh every frame, so the second hand sweeps and the clock is right again after suspend.
    property var now: new Date()
    // Each hand's angle (from the time alone) and look (from its band, the kick flash and the
    // handWaves setting). The look's parameters, and each hand's band and shape, are in
    // hands.mjs; ring.frag draws them in its colors.
    // Each band as a share of its own recent peak (LockAudio.handLevels), so the quiet highs move
    // the second hand as much as the bass moves the hour hand.
    readonly property var poses: Hands.handPoses(now, LockAudio.handLevels, {
        flash: LockAudio.flash,
        strength: LockAudio.handWaves
    })

    // Look settings, shared by every ring (LockAudio: the bar's config.json, ADR 0004).
    readonly property real intensity: LockAudio.intensity
    readonly property real bassStretch: LockAudio.bassStretch

    readonly property real size: Math.min(width, height)
    // Leaves room around the dial for the ribbons to wave into (ring.mjs).
    readonly property real dialRadius: size * Ring.DIAL_RATIO

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

        // The ribbon that is the dial, its hour points and the hands. Always on: they're the clock.
        ShaderEffect {
            anchors.fill: parent
            fragmentShader: Qt.resolvedUrl("shaders/ring.frag.qsb")

            // The hands (hands.mjs handPoses()): angles in radians, sizes in dial radii.
            property real pixel: 1 / root.dialRadius
            property real handFlash: LockAudio.flash
            property vector4d handAngle: root.perHand("angle", Math.PI / 180)
            property vector4d handInner: root.perHand("inner", 1)
            property vector4d handLength: root.perHand("length", 1)
            property vector4d handAmp: root.perHand("amplitude", 1)
            property vector4d handWidth: root.perHand("width", 1)
            property vector4d handGlow: root.perHand("glow", 1)
            // How far each hand's wave has travelled, at its own band's pace (hands.mjs).
            property vector4d handPhase: Qt.vector4d(LockAudio.handPhases.hour, LockAudio.handPhases.minute, LockAudio.handPhases.second, 0)

            // Wrapped for 32-bit precision; 1200 s keeps the hue cycle (t*0.05) seamless.
            property real time: LockAudio.time % 1200
            property real flow: LockAudio.flow
            property real kick: LockAudio.kick
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

        // The digital time, inside the dial below the center. When a shockwave's front crosses it
        // (LockAudio.timeCrossing, the same on every ring), it splits into lavender, mauve and blue
        // copies pushed outward and flares toward white with a glow (clock.mjs timeHit()). The
        // digits themselves never move.
        Item {
            id: time
            anchors.horizontalCenter: parent.horizontalCenter
            y: dial.height / 2 + root.dialRadius * Clock.TIME_TOP
            width: digits.implicitWidth
            height: digits.implicitHeight

            readonly property var hit: Clock.timeHit(LockAudio.timeCrossing)
            readonly property real em: digits.font.pixelSize

            // The source the effects draw; drawn only through them.
            Text {
                id: digits
                visible: false
                text: Clock.formatTime(root.now, {
                    use24Hour: SettingsData.use24HourClock,
                    padHours12Hour: SettingsData.padHours12Hour
                })
                color: Qt.alpha(root.lavender, 0.85)
                font.family: SettingsData.lockScreenFontFamily !== "" ? SettingsData.lockScreenFontFamily : Theme.fontFamily
                font.pixelSize: Math.max(10, root.size * 0.075)
                font.weight: Font.Medium
            }

            // The chromatic split: the digits in each of the shockwave's colors, offset outward
            // (down, away from the center), behind the digits.
            Repeater {
                model: 3

                MultiEffect {
                    required property int index
                    readonly property var copy: time.hit.copies[index]
                    source: digits
                    width: time.width
                    height: time.height
                    y: copy.offset * time.em
                    visible: copy.opacity > 0
                    opacity: copy.opacity
                    colorization: 1
                    colorizationColor: copy.color
                    blurEnabled: true
                    blur: 0.2
                    blurMax: 4
                }
            }

            // The digits, flaring toward white with a glow as the front crosses them.
            MultiEffect {
                source: digits
                anchors.fill: parent
                colorization: time.hit.white
                colorizationColor: "white"
                shadowEnabled: true
                shadowColor: Qt.rgba(0.9, 0.92, 1, 1)
                shadowHorizontalOffset: 0
                shadowVerticalOffset: 0
                shadowBlur: 1
                // The glow's radius grows with the hit up to its peak (TIME_HIT.glow font sizes).
                blurMax: Math.max(1, Math.round(Clock.TIME_HIT.glow * time.em))
                shadowScale: 1 + time.hit.glow * 0.2
                shadowOpacity: time.hit.glow / Clock.TIME_HIT.glow
            }
        }
    }
}
