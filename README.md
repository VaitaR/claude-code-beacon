# Beacon

A Claude Code mod for the desktop app's Code tab. It keeps one glyph at the front of the
session title, so the sidebar says what every session is doing without opening it:

| Glyph | State | Set when |
| --- | --- | --- |
| 🔵 | working | a turn is running |
| ⏳ | waiting | the turn ended with background tasks or a session cron still in flight, or one foreground tool call has run longer than `slowSeconds` |
| ❓ | needs you | a permission request, `AskUserQuestion` or plan approval is open, or the last reply asks you for a decision, answer or confirmation |
| ✅ | done | the turn ended, nothing is in flight, the last reply asks for nothing |

The sidebar's own icon column shows the session's kind (pull request, worktree) and only one
dot for "needs input"; it cannot tell a prose question from a report, nor a session paused on
background work from one that is finished. The title is the one row element a mod can write.

## How "needs you" is read

In order, on the last reply's closing lines:

1. the convention line `NEEDS YOU: <what>` (see `tools/instructions/core.md`, Answer shape);
2. a closing line that ends with `?`, or English/Russian phrasings of a request for a decision;
3. a reply under 400 characters with neither is `done`; a longer one goes to the engine's
   small model (`$.model.classify`) unless `classify` is off.

Tool-driven asks (permission dialogs, `AskUserQuestion`, `ExitPlanMode`) are seen directly and
need no reading.

## Install

The desktop app starts sessions without `--plugin-dir`, so the mod loads from
`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env` block, `:`-separated with other
mod folders). New sessions pick it up; running ones do not.

In a terminal session the app's `ccd_session_mgmt` server is absent: the first rename fails
with "no connected MCP tool", is logged once, and the mod stays quiet.

## Options (`pluginConfigs.beacon.options`)

| Option | Default | Meaning |
| --- | --- | --- |
| `slowSeconds` | `60` | foreground tool call length that turns 🔵 into ⏳ |
| `classify` | `true` | ask the small model when the heuristics cannot read a long reply |
| `debugLog` | `""` | absolute path of a file the mod writes its diagnostics to |

## Limits

- The rename is an MCP call made under your own PreToolUse hooks. A hook that denies a repeated
  identical MCP call (this repo's `mcp_refetch_barrier.py`) refuses the first attempt; the mod
  retries once, which that barrier lets through. Exempt the two tools with
  `MCP_REFETCH_EXEMPT=ccd_session_mgmt__(get_session|set_session_title)` to save the extra calls.
- A reload of the mod (an edit, a lost hooks worker) rereads the last reply but cannot see
  background tasks, so a ⏳ session shows ✅ or ❓ until its next turn.
- The glyph is not written before the app has generated the session's title.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
