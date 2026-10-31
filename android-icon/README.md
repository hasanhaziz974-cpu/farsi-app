Adaptive launcher icon in the same shape as Capacitor's own template: a solid colour
background (values/ic_launcher_background.xml) and a 108dp foreground PNG per density, with
no `<inset>` wrapper. The build copies these over the generated resources; icon-only.png in
the repository root is the matching legacy and store icon.

The foreground is the word "parsa" with a small «پ». An earlier speech-bubble design was
rejected as an "invalid package" by a HONOR 200 (MagicOS 10), in both the capacitor-assets
<inset> layout and this layout, while the same builds with other icons installed.
