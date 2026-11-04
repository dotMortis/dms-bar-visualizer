# install-lock.sh links the Lock Ring into DMS 2.x's plugin dir

The spec (#10) has `install-lock.sh` link the checkout into `~/.config/DankMaterialShell/plugins/`. That is DMS 1.x's user plugin dir. DMS 2.x, which the Lock Ring needs, reads user plugins from `~/.config/dms/plugins`, and a link in the old dir is never loaded. So `install-lock.sh` links into `~/.config/dms/plugins/lockRing`, and falls back to `~/.config/DankMaterialShell/plugins/lockRing` only when `~/.config/DankMaterialShell` is the sole DMS config dir there is. `--uninstall` removes the link from both.

## Considered Options

- **Follow the spec and link into `DankMaterialShell/plugins`**: rejected, because DMS 2.x never loads the plugin from there.
- **Always link into `dms/plugins`**: rejected, because a setup that still has only the DMS 1.x config dir would never load it.

## Consequences

On DMS 2.x the Lock Ring shows up after `dms restart`, as the README says. If DMS moves its user plugin dir again, `install-lock.sh`'s `plugin_dir()` must follow. The Arch package is unaffected: it installs into DMS's system plugin dir, `/etc/xdg/quickshell/dms-plugins/`, as the spec says.
