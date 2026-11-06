// The C ABI end to end from C: tests/c/smoke.c, compiled against include/visualizer_core.h and
// linked with the static library, must run clean and see the frame laid out as Rust lays it out.
use std::path::{Path, PathBuf};
use std::process::Command;

use visualizer_core::Frame;

/// Where cargo put this build's libraries, built with the rlib this test links: next to the test
/// binary, in <target>/<profile>/deps.
fn deps_dir() -> PathBuf {
    std::env::current_exe().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn a_c_program_drives_the_visualizer_through_the_header() {
    let core = Path::new(env!("CARGO_MANIFEST_DIR"));
    let library = deps_dir().join("libvisualizer_core.a");
    assert!(library.exists(), "no static library at {}", library.display());
    let program = deps_dir().join("c-smoke");
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".into());
    let built = Command::new(&cc)
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-I"])
        .arg(core.join("include"))
        .arg(core.join("tests/c/smoke.c"))
        .arg(&library)
        .args(["-lpthread", "-ldl", "-lm", "-o"])
        .arg(&program)
        .output()
        .unwrap_or_else(|e| panic!("running {cc}: {e}"));
    assert!(built.status.success(), "{cc}: {}", String::from_utf8_lossy(&built.stderr));

    let ran = Command::new(&program).output().unwrap();
    let out = String::from_utf8_lossy(&ran.stdout);
    assert!(ran.status.success(), "{out}{}", String::from_utf8_lossy(&ran.stderr));
    let layout = format!(
        "size {} kick_power {} kick_count {}",
        size_of::<Frame>(),
        std::mem::offset_of!(Frame, kick_power),
        std::mem::offset_of!(Frame, kick_count)
    );
    assert_eq!(out.lines().next(), Some(layout.as_str()));
    assert_eq!(out.lines().last(), Some("ok"));
}
