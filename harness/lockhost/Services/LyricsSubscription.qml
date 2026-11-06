// Stand-in for DMS's LyricsSubscription (Services/): holds the lyrics service while it exists.
import QtQuick
import qs.Services

QtObject {
    Component.onCompleted: LyricsService.addRef()
    Component.onDestruction: LyricsService.removeRef()
}
