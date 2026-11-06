#!/usr/bin/env bash
# Builds the core to WASM with its wasm-bindgen API (src/wasm.rs), as an ES module for the web:
# <out-dir>/visualizer_core.js and visualizer_core_bg.wasm. In a browser, `await init()` the
# module; in node, `initSync({ module: <the .wasm's bytes> })`.
#
#     core/build-wasm.sh [out-dir]    (default: core/target/wasm-web)
#     core/build-wasm.sh --wasm-bindgen-version    (prints the wasm-bindgen CLI version it needs)
#
# Needs once: rustup target add wasm32-unknown-unknown
#             cargo install wasm-bindgen-cli --version <the wasm-bindgen pinned in Cargo.toml> --locked
set -euo pipefail
core="$(cd "$(dirname "$0")" && pwd)"

# The wasm-bindgen CLI must be the exact version Cargo.toml pins.
want="$(sed -n 's/^wasm-bindgen = "=\(.*\)"$/\1/p' "$core/Cargo.toml")"
if [[ "${1:-}" == "--wasm-bindgen-version" ]]; then
    echo "$want"
    exit 0
fi
out="${1:-$core/target/wasm-web}"
have="$(wasm-bindgen --version 2>/dev/null | cut -d' ' -f2 || true)"
if [[ "$have" != "$want" ]]; then
    echo "build-wasm: needs wasm-bindgen CLI $want (have: ${have:-none}):" >&2
    echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
    exit 1
fi

cargo build --manifest-path "$core/Cargo.toml" --quiet --release --lib --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir "$out" \
    "$core/target/wasm32-unknown-unknown/release/visualizer_core.wasm"
