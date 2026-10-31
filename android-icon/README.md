Adaptive launcher icon in the same shape as Capacitor's own template: a solid colour
background and a 108dp foreground PNG, with no `<inset>` wrapper. The build copies these
over the generated resources. The `<inset>` layout that `capacitor-assets` produces from
icon-foreground.png was rejected as an "invalid package" by HONOR phones (MagicOS 10).
