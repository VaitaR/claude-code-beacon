#!/bin/sh
# Builds BeaconWidget.app into ~/Applications and starts it at login through a LaunchAgent.
# `./install.sh --uninstall` removes both.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app="$HOME/Applications/BeaconWidget.app"
label="com.vaitar.beacon-widget"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$app" "$plist"
  echo "removed $app and $plist"
  exit 0
fi

mkdir -p "$app/Contents/MacOS" "$HOME/Library/LaunchAgents"
swiftc -O -parse-as-library "$here/BeaconWidget.swift" -o "$app/Contents/MacOS/BeaconWidget"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$label</string>
  <key>CFBundleName</key><string>BeaconWidget</string>
  <key>CFBundleExecutable</key><string>BeaconWidget</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
codesign --force --sign - "$app" >/dev/null 2>&1

# KeepAlive restarts a crash but not a Quit from the menu (a clean exit).
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$app/Contents/MacOS/BeaconWidget</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
EOF
launchctl bootstrap "$domain" "$plist"
echo "installed $app, running as $label"
