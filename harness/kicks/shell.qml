// The kick check's bare shell (harness/check-kicks): the audio pipeline from the tree under test
// (HARNESS_TREE), created from its file:// URL with Qt.createComponent, and nothing else, no
// window. Each Kick is logged to qs.log as "KICK <s since HARNESS_EPOCH> <power>", which
// harness/kicks.mjs matches to the Kicks the kick-replay tests expect.
import QtQuick
import Quickshell
ShellRoot {
    id: root
    readonly property var component: Qt.createComponent("file://" + Quickshell.env("HARNESS_TREE") + "/audio/AudioPipeline.qml", Component.PreferSynchronous, root)
    property var pipeline: null
    Component.onCompleted: {
        if (component.status === Component.Error) {
            console.warn("harness: the audio pipeline didn't load: " + component.errorString());
            return;
        }
        pipeline = component.createObject(root, { confPath: Quickshell.env("XDG_RUNTIME_DIR") + "/harness-kicks-cava.conf" });
        pipeline.kicked.connect(power => console.log("KICK " + (Date.now() / 1000 - Number(Quickshell.env("HARNESS_EPOCH"))).toFixed(4) + " " + power.toFixed(3)));
    }
}
