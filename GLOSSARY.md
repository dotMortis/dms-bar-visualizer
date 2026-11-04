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
