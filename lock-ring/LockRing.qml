// The Lock Ring: a DMS desktop plugin placed on the lock screen (Settings -> Lock Screen).
// A clock: a living neon ribbon as the dial with 12 hour points riding on it, three floating hands
// that always point at the true time (the second hand sweeps), and a small HH:MM below the center
// in DMS's lock-screen font and 12h/24h setting. The hands show the music too (hands.mjs): hour =
// bass, minute = mids, second = highs, each a neon wave ribbon that swings, thickens and glows
// with its band (measured against that band's own recent peak) around a straight axis that never
// moves off the time. The ribbon (ring.mjs) idles in silence as a thin, faint, breathing wave;
// music grows it into spectrum ribbons that wave around the swelling dial, and the ring swells
// with its energy. shaders/ring.frag draws all of that. On every Kick a chromatic Shockwave
// expands from the center (kicks.mjs) as the center punches white-lavender, sparks fly off the
// ring and all hands flash and get a small push; the ribbons surge and the hour points flash as
// its front crosses them. The Aura around the ribbons doesn't flash: a Kick only pushes it outward
// a little. As the front crosses the
// digital time, drawn here, the time splits into the Shockwave's colors and glows (clock.mjs
// timeHit()).
// The Lyric Words of the playing song (LockAudio.lyricWords, from DMS's lyrics service) land on
// the ribbons and hands as they are sung, drawn here (lyrics.mjs).
// Every ring on every monitor draws from the one shared capture in LockAudio.
import QtQuick
import QtQuick.Effects
import qs.Common
import qs.Modules.Plugins
import "clock.mjs" as Clock
import "hands.mjs" as Hands
import "kicks.mjs" as Kicks
import "lyrics.mjs" as Lyrics
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

    // Read fresh on every frame of the rings (LockAudio's one clock, so every monitor's ring shows
    // the same time), so the second hand sweeps and the clock is right again after suspend. In
    // Silence the frames come at LockAudio's slow pace (pace.mjs SILENCE_FPS), still on time.
    property var now: LockAudio.now
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

    // What the Lyric Words ride on this frame (lyrics.mjs wordPlacement()): the ring's inputs as
    // ring.frag gets them, and the hands.
    readonly property var lyricScene: ({
        dialRadius: root.dialRadius,
        values: LockAudio.values,
        flow: LockAudio.flow,
        time: LockAudio.time % 1200,
        treble: LockAudio.treble,
        swell: LockAudio.swell,
        kick: LockAudio.kick,
        bassStretch: root.bassStretch,
        kickAges: LockAudio.kickAges,
        kickPowers: LockAudio.kickPowers,
        kickSeeds: LockAudio.kickSeeds,
        poses: root.poses,
        phases: LockAudio.handPhases
    })

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

        // The digital time, inside the dial below the center. When a Shockwave's front crosses it
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
                font.pixelSize: Math.max(10, root.size * Clock.TIME_FONT)
                font.weight: Font.Medium
            }

            // The chromatic split: the digits in each of the Shockwave's colors, offset outward
            // (down, away from the center), behind the digits, softened by TIME_HIT.soften.
            Repeater {
                model: Clock.TIME_HIT.split.length

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
                    blur: 1
                    blurMax: Math.max(1, Math.round(Clock.TIME_HIT.soften * time.em))
                }
            }

            // The digits, flaring toward white with a glow as the front crosses them: the glow at
            // TIME_HIT.glow's color and radius, its opacity and spread growing with the hit.
            MultiEffect {
                source: digits
                anchors.fill: parent
                colorization: time.hit.white
                colorizationColor: "white"
                shadowEnabled: true
                shadowColor: Clock.TIME_HIT.glow.color
                shadowHorizontalOffset: 0
                shadowVerticalOffset: 0
                shadowBlur: 1
                blurMax: Math.max(1, Math.round(Clock.TIME_HIT.glow.radius * time.em))
                shadowScale: time.hit.glow.scale
                shadowOpacity: time.hit.glow.opacity
            }
        }

        // The Lyric Words (LockAudio.lyricWords, the same on every ring): each lands on a Ribbon,
        // bent along its curve and riding its wave, or on a Hand, lying along it and turning with
        // it (lyrics.mjs wordPlacement()). Each glows in the colour there with a bright core, pops
        // in oversized with a flash (harder with a Kick), dissolves with its line, and splits and
        // flares as a Shockwave's front crosses it, as the Digital Time does (lyrics.mjs wordLook()).
        Repeater {
            // One delegate per word, kept from its pop-in to its dissolve (LockAudio.lyricWordModel).
            model: LockAudio.lyricWordModel

            Item {
                id: word
                required property string wordId
                required property string text
                readonly property var entry: LockAudio.lyricWords[wordId] ?? null
                readonly property var chars: Array.from(text)
                // A word keeps its size (lead or background vocal), so its box and spacing do too.
                readonly property real em: Math.max(8, root.size * Lyrics.WORD_FONT * (entry?.size ?? 1))
                // Measured in the letters' font: read through metrics.font, so it's measured again
                // once the font is set (a method call alone wouldn't tie it to the font).
                readonly property var advances: metrics.font.pixelSize > 0 ? chars.map(c => metrics.advanceWidth(c)) : []
                readonly property real span: advances.reduce((sum, a) => sum + a, 0)
                readonly property var place: entry ? Lyrics.wordPlacement(entry.spot, advances, root.lyricScene) : null
                readonly property real crossing: place ? Kicks.shockwaveCrossing(place.radius, LockAudio.kickAges, LockAudio.kickPowers, LockAudio.kickSeeds, place.theta) : 0
                readonly property var look: Lyrics.wordLook(entry ?? {}, crossing)
                readonly property color glow: place?.color ?? root.lavender
                // Outward, away from the center: where the Shockwave's copies are pushed.
                readonly property real outX: place ? place.x / Math.max(1, Math.hypot(place.x, place.y)) : 0
                readonly property real outY: place ? place.y / Math.max(1, Math.hypot(place.x, place.y)) : 1
                // A square around the word's middle, wide enough for its letters however they bend.
                readonly property real box: Math.ceil(span + 3 * em)

                visible: place !== null && look.opacity > 0
                width: box
                height: box
                x: dial.width / 2 + (place?.x ?? 0) - box / 2
                y: dial.height / 2 + (place?.y ?? 0) - box / 2
                scale: look.scale
                opacity: look.opacity

                FontMetrics {
                    id: metrics
                    font: letterFont.font
                }

                Text {
                    id: letterFont
                    visible: false
                    font.family: SettingsData.lockScreenFontFamily !== "" ? SettingsData.lockScreenFontFamily : Theme.fontFamily
                    font.pixelSize: word.em
                    font.weight: Font.DemiBold
                }

                // The letters, each on its own spot along the curve; drawn only through the effects.
                Item {
                    id: letters
                    visible: false
                    width: word.box
                    height: word.box

                    Repeater {
                        model: word.chars.length

                        Text {
                            required property int index
                            readonly property var glyph: word.place?.glyphs[index] ?? { x: 0, y: 0, rotation: 0 }
                            text: word.chars[index]
                            font: letterFont.font
                            // A bright core in the word's colour.
                            color: Qt.tint(word.glow, Qt.rgba(1, 1, 1, Lyrics.WORD_LOOK.core))
                            x: word.box / 2 + glyph.x - (word.place?.x ?? 0) - width / 2
                            y: word.box / 2 + glyph.y - (word.place?.y ?? 0) - height / 2
                            rotation: glyph.rotation
                        }
                    }
                }

                // The Shockwave's chromatic split, as the Digital Time's: the word in each of its
                // colours, pushed outward, behind the word.
                Repeater {
                    model: Clock.TIME_HIT.split.length

                    MultiEffect {
                        required property int index
                        readonly property var copy: word.look.hit.copies[index]
                        source: letters
                        width: word.box
                        height: word.box
                        x: word.outX * copy.offset * word.em
                        y: word.outY * copy.offset * word.em
                        visible: copy.opacity > 0
                        opacity: copy.opacity
                        colorization: 1
                        colorizationColor: copy.color
                        blurEnabled: true
                        blur: 1
                        blurMax: Math.max(1, Math.round(Clock.TIME_HIT.soften * word.em))
                    }
                }

                // The word, glowing in its colour (toward the Shockwave's glow as it crosses),
                // flashing toward white as it lands and as a front crosses it, blurring away as it
                // dissolves.
                MultiEffect {
                    source: letters
                    anchors.fill: parent
                    colorization: word.look.white
                    colorizationColor: "white"
                    // Always on, blurring by 0 until it dissolves: switching it rebuilds the effect,
                    // a visible hitch just as the word starts to dissolve.
                    blurEnabled: true
                    blur: word.look.blur
                    shadowEnabled: true
                    shadowColor: Qt.tint(word.glow, Qt.alpha(Clock.TIME_HIT.glow.color, word.look.hit.glow.opacity * 0.6))
                    shadowHorizontalOffset: 0
                    shadowVerticalOffset: 0
                    shadowBlur: 1
                    blurMax: Math.max(1, Math.round(Lyrics.WORD_LOOK.glow.radius * word.em))
                    shadowScale: word.look.hit.glow.scale + Lyrics.WORD_LOOK.glow.spread
                    shadowOpacity: 1
                }
            }
        }
    }
}
