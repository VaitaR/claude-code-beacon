# Beacon widget

A native macOS floating panel listing every Claude Code session the beacon mod reports:
translucent, above other windows, on every Space, no Dock icon. One Swift file
(`BeaconWidget.swift`), no dependencies.

## Set up on a new machine

1. Prerequisites: macOS 15+ (`WindowDragGesture`), `swiftc` (Xcode Command Line Tools:
   `xcode-select --install`), the Claude desktop app, this repo cloned to `~/projects/claude-code-beacon`.
2. Load the mod in every session: in `~/.claude/settings.json`, `env.CLAUDE_CODE_PLUGIN_DIRS`
   includes `/Users/<you>/projects/claude-code-beacon` (`:`-separated with other mod folders).
   Running sessions pick it up on their next process start; see `../README.md`, Install.
3. Build, install and start at login:

   ```sh
   ~/projects/claude-code-beacon/widget/install.sh
   ```

   This writes `~/Applications/BeaconWidget.app` (ad-hoc signed) and the LaunchAgent
   `~/Library/LaunchAgents/com.vaitar.beacon-widget.plist`. `--uninstall` removes both.
4. Check: `ls ~/.claude/state/beacon/` fills as sessions change state;
   `launchctl print gui/$(id -u)/com.vaitar.beacon-widget` shows `state = running`.

## How it works

```
session (mod: hooks/register.ts) --state change--> ~/.claude/state/beacon/<engine session id>.json
widget (1 s poll) --reads dir--> rows --click--> app deep link | cmux CLI
```

Status file, one per session, rewritten on every state change:

| Field | Source |
| --- | --- |
| `id`, `link`, `archived`, `cwd` | `ccd_session_mgmt` `get_session("self")`; a terminal session has no app, so `id` is the engine id and `link` is empty |
| `title` | the app title without the glyph; a terminal session uses its folder name |
| `state` | `working`, `waiting`, `needs-you`, `done`, `error`, or `null` (cleared: hidden) |
| `ended`, `updatedAt` | `session.end` seen; time of the last state change |
| `cmux` | only inside cmux: `workspace`, `panel`, `socket`, `capability`, `bundle` from the `CMUX_*` env |

## Behaviour

- Rows sort by attention (❓ ⚠️ ⏳ 🔵 ✅); the time is how long the session has been in its state.
- Click opens the session; a dimmed row has nothing to open (a plain-terminal session). × on a
  hovered row deletes its files; a live session returns on its next state change.
- Drag the header to move, click it to collapse to counts; right-click for opacity,
  hide/clear finished, quit. The list scrolls past 360 points.
- Hidden: archived, `state: null`, ✅ older than 3 h, anything else older than 24 h.
- Two files with the same `id` (an older mod build named files by app id) show as one row, the newest.

## Facts that are not obvious

- **Desktop deep link.** `get_session` returns `link: claude://claude.ai/epitaxy/<app session id>`;
  `open` on it focuses that session in the app.
- **File name = engine session id** (`$.session.id()`), not the app's `local_…` id:
  it matches the transcript `~/.claude/projects/*/<id>.jsonl`, so a cleanup script can tell a
  live session's file from a test leak.
- **cmux.** Its socket defaults to `cmuxOnly` (processes started inside cmux; others get
  "Access denied"). Every process inside cmux gets `CMUX_SOCKET_CAPABILITY`, and that token
  works from outside too, so the widget runs
  `cmux select-workspace --workspace W` + `cmux focus-panel --panel P --workspace W` with it,
  then activates cmux. No cmux settings change. The `cmux://` URL scheme is auth-only. The
  token lives in `~/.claude/state` (mode 0700); a cmux restart likely invalidates it until the
  session writes again.
- **Clicks in an always-inactive app.** An accessory app's panel needs `acceptsFirstMouse = true`,
  or SwiftUI taps get lost intermittently; `isMovableByWindowBackground` turns slightly-moving
  clicks into drags, so only the header drags (`WindowDragGesture`).
- **Scroll height.** A `ScrollView` sized from a measured content height starts at 0 and never
  lays out its content; rows have a fixed height so the list height is computed.
- **launchd.** `KeepAlive.SuccessfulExit = false`: a crash restarts, menu Quit stays quit.

## Develop and verify

Screen capture needs Screen Recording permission. Without it, build the snapshot variant,
which renders the panel offscreen (light appearance, no blur) and exits:

```sh
swiftc -D SNAPSHOT -parse-as-library BeaconWidget.swift -o /tmp/beacon-snap
BEACON_STATE_DIR=<fixtures dir> BEACON_SNAPSHOT=/tmp/beacon.png /tmp/beacon-snap
```

Optional in that build: `BEACON_HOVER=1` draws rows hovered (× visible),
`BEACON_OPEN=<id>` runs a row's click, `BEACON_DISMISS=<id>` its ×. `BEACON_STATE_DIR` also
works in the installed build. After editing, rerun `install.sh`; mod-side logic is covered by
`claude plugin test ..`.

## Limits

- A session whose process dies without `session.end` keeps its last state until the 24 h cutoff.
- `archived` is read only when the mod writes, so archiving an idle session does not hide it.
- Headless `claude -p` runs also write files; they show dimmed once ended, removable with ×.
- `claude --resume` in a terminal: not checked whether the engine id survives; if not, the old
  row stays beside the new one.
