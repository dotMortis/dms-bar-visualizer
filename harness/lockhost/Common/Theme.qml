// Stand-in for DMS's Theme (Common/): its default font, which the Lock Ring's Digital Time uses.
// DMS ships that font itself; here it's the family name, so the system's font where it lacks it.
pragma Singleton
import Quickshell

Singleton {
    property string fontFamily: "Google Sans Flex"
}
