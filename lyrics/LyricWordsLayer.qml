// The Lyric Words on one screen's bar, laid over its shader with the same size. Each word rides its
// Ribbon letter by letter (docs/bar-words.mjs layWord()), glows in that Ribbon's color with a
// bright core (docs/bar-ribbons.mjs ribbonColor()), pops in with a flash, harder with a Kick, flares
// and splits into the Shockwave's colors as a front crosses it (shockwaveCrossing(), wordLook()),
// and dissolves with its line. Which words show is BarLyrics.qml's.
//
//   LyricWordsLayer {
//       lyrics: barLyrics     // BarLyrics
//       inputs: ({ ... })     // docs/bar-ribbons.mjs ribbonHeight()'s, for this bar
//   }
import QtQuick
import QtQuick.Effects
import "../docs/bar-ribbons.mjs" as BarRibbons
import "../docs/bar-words.mjs" as BarWords

Item {
    id: bar

    required property var lyrics
    required property var inputs

    readonly property real em: Math.max(8, Math.round(height * BarWords.LOOK.font))
    clip: true

    FontMetrics {
        id: metrics
        font.pixelSize: bar.em
        font.weight: Font.DemiBold
    }

    Repeater {
        model: bar.lyrics.words

        Item {
            id: word

            required property string wordId
            required property string text
            required property int ribbon
            required property real spotX

            readonly property var entry: bar.lyrics.current[wordId] ?? null
            readonly property var letters: Array.from(text)
            readonly property var advances: letters.map(c => metrics.advanceWidth(c))
            readonly property real span: advances.reduce((a, b) => a + b, 0)
            readonly property var glyphs: entry ? BarWords.layWord({ ribbon, x: spotX }, advances, Object.assign({ clearance: metrics.height * 0.32 }, bar.inputs)) : []
            readonly property real middle: glyphs.length > 0 ? (glyphs[0].x + glyphs[glyphs.length - 1].x) / 2 : 0
            readonly property real middleY: glyphs.length > 0 ? glyphs.reduce((a, g) => a + g.y, 0) / glyphs.length : bar.height / 2
            readonly property var look: entry ? BarWords.wordLook(entry, BarRibbons.shockwaveCrossing(middle, bar.inputs)) : null
            readonly property var rgb: entry ? BarRibbons.ribbonColor(middle, ribbon, bar.inputs) : [1, 1, 1]
            readonly property color hue: Qt.rgba(rgb[0], rgb[1], rgb[2], 1)
            // The bright core: the Ribbon's color, most of the way to white, all the way in a flash.
            readonly property real whiten: look ? 0.55 + 0.45 * look.white : 0.55
            readonly property color core: Qt.rgba(rgb[0] + (1 - rgb[0]) * whiten, rgb[1] + (1 - rgb[1]) * whiten, rgb[2] + (1 - rgb[2]) * whiten, 1)
            // The split goes outward, away from the bar's center.
            readonly property real outward: middle < bar.width / 2 ? -1 : 1

            visible: look !== null && look.opacity > 0
            opacity: look ? Math.min(1, look.opacity) : 0
            width: bar.width
            height: bar.height

            // The letters, drawn only through the effects below. Wide enough for the glow.
            Item {
                id: letterBox
                visible: false
                x: Math.max(0, word.middle - word.span / 2 - bar.em)
                width: Math.min(bar.width - x, word.span + 2 * bar.em)
                height: bar.height

                Repeater {
                    model: word.letters.length

                    Text {
                        required property int index
                        readonly property var glyph: word.glyphs[index] ?? { x: 0, y: 0, angle: 0 }
                        text: word.letters[index]
                        font: metrics.font
                        color: word.core
                        x: glyph.x - letterBox.x - width / 2
                        y: glyph.y - height / 2
                        rotation: glyph.angle
                    }
                }
            }

            // The chromatic split, behind the word: copies in the Shockwave's colors.
            Repeater {
                model: BarWords.LOOK.hit.split.length

                MultiEffect {
                    required property int index
                    readonly property var copy: word.look ? word.look.copies[index] : null
                    source: letterBox
                    x: letterBox.x + (copy ? copy.offset * bar.em * word.outward : 0)
                    width: letterBox.width
                    height: letterBox.height
                    visible: copy !== null && copy.opacity > 0.01
                    opacity: copy ? copy.opacity : 0
                    colorization: 1
                    colorizationColor: copy ? copy.color : "white"
                    blurEnabled: true
                    blur: 0.4
                    blurMax: Math.max(1, Math.round(0.08 * bar.em))
                    transform: Scale {
                        origin.x: word.middle - letterBox.x
                        origin.y: word.middleY
                        xScale: word.look ? word.look.scale : 1
                        yScale: xScale
                    }
                }
            }

            // The word: its bright core, glowing in its Ribbon's color, blurring out as it dissolves.
            MultiEffect {
                source: letterBox
                x: letterBox.x
                width: letterBox.width
                height: letterBox.height
                shadowEnabled: true
                shadowColor: word.hue
                shadowHorizontalOffset: 0
                shadowVerticalOffset: 0
                shadowBlur: 1
                blurMax: Math.max(1, Math.round(0.45 * bar.em))
                shadowScale: 1 + 0.06 * Math.max(0, (word.look ? word.look.glow : 0) - 0.5)
                shadowOpacity: Math.min(1, word.look ? word.look.glow : 0)
                blurEnabled: word.look !== null && word.look.blur > 0
                blur: word.look ? word.look.blur : 0
                transform: Scale {
                    origin.x: word.middle - letterBox.x
                    origin.y: word.middleY
                    xScale: word.look ? word.look.scale : 1
                    yScale: xScale
                }
            }
        }
    }
}
