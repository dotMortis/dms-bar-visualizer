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

**Kick**:
One detected bass-drum hit, fired once per hit when a band in the kick range rises sharply above its recent level.
_Avoid_: beat, onset

## Look

**Shockwave**:
The chromatic front a Kick sends out from the center of either visualizer, brighter and farther-reaching on a harder hit. On the Lock Ring the front is ragged and flickering, rougher on a harder hit, and carries beads of light along it.
_Avoid_: kick wave, kick blast, blast

**Aura**:
The soft spectrum-colored glow around the ribbons that grows with the music. On the Lock Ring it follows the music alone: a Kick doesn't brighten or widen it.
_Avoid_: halo, halo flow, glow
