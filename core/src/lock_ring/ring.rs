// The Lock Ring's look, apart from drawing: where the spectrum sits on the ring, the ribbon that is
// the Dial, the 12 Hour Points riding on it, and how the ring swells with the music. Ported from
// v0.10.0's docs/lock-ring/ring.mjs; ring.frag mirrors it.

/// The Dial's radius as a share of the widget's side, leaving room around it for the ribbons to
/// wave into. ring.frag's DIAL_RATIO.
pub const DIAL_RATIO: f64 = 0.34;
