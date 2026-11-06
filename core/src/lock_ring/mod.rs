//! The Lock Ring, apart from drawing: its Shockwaves, its living ribbon and Hour Points, its Hands
//! and its Digital Time, ported from v0.10.0's docs/lock-ring/*.mjs. lock-ring/shaders/ring.frag
//! draws them and repeats these numbers (tests/lock_constants.rs keeps them in step).
mod clock;
mod frame;
mod hands;
mod kicks;
mod ring;
mod words;

pub use clock::*;
pub(crate) use frame::LockRing;
pub use frame::{LockRingFrame, AT_REST, SILENCE_FPS};
pub use hands::*;
pub use kicks::*;
pub use ring::*;
pub use words::*;
