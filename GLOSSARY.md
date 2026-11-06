# dms-bar-visualizer

Music visualizers for DankMaterialShell that react to whatever is playing: one behind the top bar, one on the lock screen.

## Visualizers

**Bar Visualizer**:
The visualizer that lives behind the DankBar, sized and inset like the bar.
_Avoid_: bar viz, the visualizer (ambiguous now that there are two)

**Lock Ring**:
The lock-screen visualizer: a circular spectrum around an analog-plus-digital clock whose hands also react to the music. Installed separately from the Bar Visualizer.
_Avoid_: lock visualizer, lock widget, ring clock

## Audio

**Active Player**:
The MPRIS player DankBar shows; both visualizers capture the output this player's stream plays to.
_Avoid_: current player, source

**Silence**:
When there is nothing to hear: no Active Player, the Active Player paused, or it playing but its output silent. In Silence the Bar Visualizer holds still; the Lock Ring's Ribbon keeps breathing as a thin, faint wave.
_Avoid_: idle, rest, pause (only one of the three cases)

**Kick**:
One detected bass-drum hit, fired once per hit when a band in the kick range rises sharply above its recent level.
_Avoid_: beat, onset

## Lyrics

**Lyric Line**:
The line of the Active Player's song being sung right now, taken from lyrics timed to the song. It is on screen as its Lyric Words, and nothing when there is none. On the Lock Ring only one Lyric Line is ever on screen; on the bar the last one's words linger a moment, fading, while the next one's come: plain, untimed lyrics are never shown.
_Avoid_: lyrics (for the single line), caption, subtitle

**Lyric Words**:
The words of the Lyric Line, each appearing as it is sung on a Ribbon (or, on the Lock Ring, a Hand) and moving with it: on the Lock Ring each at a random spot, on the bar in a row, its first word at a random spot and the rest after it, glowing in that Ribbon's color. Each pops in with a small flash as it lands. They pile up until the line's end, then dissolve together (on the bar, after lingering a moment). Background vocals are smaller and dimmer. They are decoration, not meant to be read along.
_Avoid_: lyric sparks, lyric particles, floating words

## Look

**Shockwave**:
The chromatic front a Kick sends out from the center of either visualizer, brighter and farther-reaching on a harder hit. On the Lock Ring the front is ragged and flickering, rougher on a harder hit, and carries **Beads** of light along it that spread apart as it grows.
_Avoid_: kick wave, kick blast, blast

**Aura**:
The soft spectrum-colored glow around the ribbons that grows with the music. On the Lock Ring a Kick never brightens it, only pushes it outward a little.
_Avoid_: halo, halo flow, glow

**Ribbons**:
The neon strands, shaped by the spectrum, that both visualizers draw in round curves: along the bar on the Bar Visualizer, waving outward from the Dial on the Lock Ring, never inside it.
_Avoid_: lines, waves, strands

**Spray**:
The sparks a Kick flings out of a visualizer, streaking away from where the Shockwave starts.
_Avoid_: particles, kick sparks, burst

**Center Punch**:
The flash of light where a Shockwave is born.
_Avoid_: center flash, kick flash

**Haze**:
The Bar Visualizer's plasma glow that flashes across the bar on hard Kicks and is invisible at rest. The Lock Ring has none.
_Avoid_: plasma, flash, Aura (a different glow)

**Treble Sparks**:
The Bar Visualizer's small twinkles that come and go with the treble, not with Kicks.
_Avoid_: sparks (alone), glitter, Spray (a different thing)

## Lock Ring parts

**Dial**:
The circle the Lock Ring's Ribbons wave outward from, swelling with the music's energy. The Aura glows both ways around it.
_Avoid_: ring (alone), circle, face

**Hour Points**:
The 12 points riding on the Ribbons at the hour positions, flashing as a Shockwave reaches them.
_Avoid_: hour marks, ticks, dots

**Hands**:
The Lock Ring's floating hour, minute and second hands, which swing with the music and flash on a Kick but always show the true time.
_Avoid_: clock hands, pointers

**Digital Time**:
The time in digits inside the Dial, below its center, which flares and splits into colored copies as a Shockwave crosses it.
_Avoid_: clock text, digits, time label
