// Who holds the Lock Ring's one shared audio capture. LockAudio.qml runs cava while it's active.
// Counts holders, not calls, so a ring that joins or leaves twice can't keep the capture running
// after unlock or stop it under another monitor's ring. Plain JS for tests/lock-share.test.mjs.
export function createShare() {
    const holders = new Set();
    return {
        join(holder) {
            holders.add(holder);
            return holders.size;
        },
        leave(holder) {
            holders.delete(holder);
            return holders.size;
        },
        get active() {
            return holders.size > 0;
        },
    };
}
