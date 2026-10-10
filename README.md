# Beacon

A Claude Code mod for the desktop app's Code tab. It keeps one glyph at the front of the
session title, so the sidebar says what every session is doing without opening it:

| Glyph | State | Set when |
| --- | --- | --- |
| 🔵 | working | a turn is running |
| ⏳ | waiting | the turn ended with background tasks or a session cron still in flight, or one foreground tool call has run longer than `slowSeconds` |
| ❓ | needs you | a permission request, `AskUserQuestion` or plan approval is open, or the last reply asks you for a decision, answer or confirmation |
| ✅ | done | the turn ended, nothing is in flight, the last reply asks for nothing |
| ⚠️ | error | the turn ended on an API error, rate limit or overflow, or a ⏳ session has waited `staleMinutes` without a wake-up; an interrupt by you stays ✅ |

The sidebar's own icon column shows the session's kind (pull request, worktree) and only one
dot for "needs input"; it cannot tell a prose question from a report, nor a session paused on
background work from one that is finished. The title is the one row element a mod can write.

## How "needs you" is read

In order, on the last reply's closing lines:

1. the convention line `NEEDS YOU: <what>` (see `tools/instructions/core.md`, Answer shape);
2. a closing line that ends with `?`, or English/Russian phrasings of a request for a decision;
3. a reply with neither is `done`. With `classify` on, a reply over 400 characters goes to the
   engine's small model (`$.model.classify`) instead; off by default, because that model
   reads a long report that merely mentions a possible choice as a question.

Tool-driven asks (permission dialogs, `AskUserQuestion`, `ExitPlanMode`) are seen directly and
need no reading.

## Install

The desktop app starts sessions without `--plugin-dir`, so the mod loads from
`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env` block, `:`-separated with other
mod folders). A session picks it up when the app starts its process: a new session, or an idle one on its
next message. A process already running when the setting changed never does.

In a terminal session the app's `ccd_session_mgmt` server is absent: the first rename fails
with "no connected MCP tool", is logged once, and the mod stays quiet.

## Desktop widget

Each state change also writes `~/.claude/state/beacon/<engine session id>.json` (app session
id, title without the glyph, cwd, app link, state, `updatedAt`). `widget/` is a native floating panel that lists
those files: translucent, above other windows, on every Space, no Dock icon.

```sh
widget/install.sh              # build ~/Applications/BeaconWidget.app, start it now and at login
widget/install.sh --uninstall
```

- Rows sort by attention (❓ ⚠️ ⏳ 🔵 ✅); the time is how long the session has been in its state.
- Click a row to open the session in the app; click the header to collapse to the counts;
  drag anywhere to move; right-click for opacity, hiding or clearing finished rows, and quit.
- Hidden: archived sessions, ✅ older than 3 hours, any other state older than 24 hours.
- A terminal session shows under its folder name and has no link to open.
- A session whose process dies without `session.end` keeps its last state until the 24-hour
  cutoff; the archive flag is read only when the mod writes, so archiving an idle session does
  not hide it.

## Options (`pluginConfigs.beacon.options`)

| Option | Default | Meaning |
| --- | --- | --- |
| `slowSeconds` | `60` | foreground tool call length that turns 🔵 into ⏳ |
| `staleMinutes` | `60` | how long a ⏳ session may wait for its wake-up before it turns ⚠️ (the operating rules cap a self-chosen wait at 55 minutes) |
| `classify` | `false` | ask the small model when the heuristics cannot read a long reply |
| `debugLog` | `""` | absolute path for the mod's diagnostics; each session writes its own file, the first 8 characters of its id inserted before `.log` |

## Limits

- The rename is an MCP call made under your own PreToolUse hooks. A hook that denies a repeated
  identical MCP call (this repo's `mcp_refetch_barrier.py`) refuses the first attempt; the mod
  retries once, which that barrier lets through. Exempt the two tools with
  `MCP_REFETCH_EXEMPT=ccd_session_mgmt__(get_session|set_session_title)` to save the extra calls.
- A reload of the mod (an edit, a lost hooks worker) rereads the last reply but cannot see
  background tasks or how the last turn ended, so a ⏳ or ⚠️ session shows ✅ or ❓ until
  its next turn.
- The glyph is not written before the app has generated the session's title, during a new
  session's first turn; it follows within one 10-second tick.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
