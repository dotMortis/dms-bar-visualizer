# The Lock Ring tunes shared settings as percentages of them, not overrides

The Lock Ring sometimes wants to differ from the bar: brighter, or with Kicks that fire more or less easily. It gets percentages of the bar's settings in its `lockRing` section (`intensityPercent`, `kickLowHzPercent`, `kickHighHzPercent`, `kickThresholdPercent`, `kickCooldownPercent`, each `100` = the same as the bar), not values of its own. So retuning the bar still retunes the ring, and nothing has to be tuned twice, which is why both read one `config.json` ([ADR 0004](0004-both-visualizers-read-one-config-json.md)). This works because the Lock Ring runs its own capture and Kick detector, apart from the bar's.

## Considered Options

- **Absolute Lock Ring overrides (`lockRing.intensity: 1.2`, set or not)**: rejected. Once set, an override cuts the ring loose from the bar's value, and the user is back to tuning the same setting in two places.
- **A factor (`1.0` = the same), like `speed` and `handWaves`**: rejected. A percentage reads more clearly in a hand-edited file.

## Consequences

A percentage of `0` stays `0`: with `kickCooldown` at `0`, `kickCooldownPercent` does nothing. A negative percentage counts as `0`. The Lock Ring can fire Kicks on other hits than the bar, which doesn't show while the screen is locked anyway.
