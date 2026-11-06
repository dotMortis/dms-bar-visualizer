# No script in the per-frame hot path: one Rust core, built to native and WASM

Up to v0.10.0 every audio frame and every video frame ran through JavaScript: cava's bands parsed from text, the Kick detector, the Ribbons' shape for the Lyric Words, their layout and look, each word drawn with its own blurred layers. With Lyric Words on, the Bar Visualizer used 20% or more of a core. From now on nothing that runs once per audio or video frame is script: it is either compiled code or the GPU. Slow, rare work (reading `config.json`, asking DMS for lyrics, following the Active Player) may stay in QML. The compiled part is one Rust core (Kicks, Ribbons, word layout, clock), built to native for both visualizers, through a thin C++ QML module, and to WASM for the browser demo. So there is still exactly one Kick detector, and the demo stays a faithful twin. There is no CPU budget: the target is as low as it goes, judged by an independent council of reviewers, with the method and numbers in `docs/performance.md`.

## Considered Options

- **Keep the JS, just optimize it**: rejected. The obvious wins (don't redraw in Silence, parse the bands once, stop polling `pactl`, no blur layers for each word) come first anyway, but QML's JS engine still allocates and re-evaluates bindings every frame. The cost stays in the language.
- **Keep the JS for the demo and maintain a native copy**: rejected. Two Kick detectors drift apart, and "the same Kicks everywhere" stops being true.
- **C++ for the core**: rejected. It would mean one language with the QML module, but a memory error in the core takes down DMS's lock screen ([ADR 0008](0008-lock-ring-loads-a-native-module-inside-dms.md)). Rust's safety is worth a second toolchain.
- **A standalone native Bar Visualizer without Quickshell**: deferred, not chosen. It means rewriting MPRIS, Hyprland, layer-shell and config handling. Only if the profile shows Quickshell itself costing a lot once the hot path is native.

## Consequences

Installing now means building: the AUR packages need cargo and cmake, and `install.sh`/`install-lock.sh` build from source on other distros. The demo's WASM is built by a GitHub Pages Action, not committed. The core's logic is tested with `cargo test` on `tests/fixtures`, plus a check that the WASM build detects the same Kicks as the native one. `config.json` stays fully compatible.
