# Beacon

A Claude Code mod for the desktop app's Code tab. It keeps one glyph at the front of the
session title, so the sidebar says what every session is doing without opening it:

| Glyph | State | Set when |
| --- | --- | --- |
| 🔵 | working | a turn is running |
| ⏳ | waiting | the turn ended with background tasks or a session cron still in flight, or one foreground tool call has run longer than `slowSeconds` |
| ❓ | needs you | a permission request, `AskUserQuestion`, plan approval or a `start_session` "New session / Do it here" card is open; the turn left a proposed-session card or ended on a `wrap_up` with an `ask`; or the last reply asks you for a decision, answer or confirmation |
| ✅ | done | the turn ended, nothing is in flight, the last reply asks for nothing |
| ⚠️ | error | the turn ended on an API error, rate limit, overflow or a refusal, or a ⏳ session has waited `staleMinutes` without a wake-up; an interrupt by you stays ✅ |

A settled glyph (❓ ✅ ⚠️) is followed by the local time the session settled, `✅ 14:05 Fix the
parser`: a title cannot tick, so it is a clock time, not an age. A reload keeps the time already
in the title. With `markUnread` on, a turn that ends ❓, ✅ or ⚠️ also sets the sidebar's blue
unread dot, so the dot marks results not yet opened; an interrupt by you sets none.

The sidebar's own icon column shows the session's kind (pull request, worktree) and only one
dot for "needs input"; it cannot tell a prose question from a report, nor a session paused on
background work from one that is finished. The title is the one row element a mod can write.

## How "needs you" is read

A turn that ends on the desktop app's `wrap_up` tool has no closing text of its own: a non-empty
`ask` or `blocked` makes it ❓ outright, and otherwise its `recap` is read as the reply.

In order, on the last reply's closing lines (a trailing postmortem block of `friction:` /
`key: value` lines is dropped first):

1. the convention line `NEEDS YOU: <what>` (see below), at the start of a line anywhere in the
   last ~2,000 characters, so a code block after it does not hide it;
2. a closing line that ends with `?`, or English/Russian phrasings of a request for a decision;
3. a reply with neither is `done`. With `classify` on, a reply over 400 characters goes to the
   engine's small model (`$.model.classify`) instead; off by default, because that model
   reads a long report that merely mentions a possible choice as a question.

Tool-driven asks (permission dialogs, `AskUserQuestion`, `ExitPlanMode`, a `start_session`
call with `initiation: "offer"`) are seen directly and need no reading. A `start_session` card
proposed with `initiation: "own_initiative"` and not withdrawn by `dismiss_task` in the same turn
makes the turn end ❓.

The first rule is the reliable one. Add this to your `~/.claude/CLAUDE.md` so the model writes
the line whenever it stops for you:

```markdown
- Stop only for what needs the person (a decision, an answer, a required approval). End that
  stop with `NEEDS YOU: <what, one line>`. A reply that needs nothing ends without a question.
```

## Install

Inside Claude Code (2.1.287 or later):

```
/plugin marketplace add VaitaR/claude-code-beacon
/plugin install beacon@claude-code-beacon
/reload-plugins
```

From a clone, for the desktop app: it starts sessions without `--plugin-dir`, so add the clone
to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env` block, `:`-separated with other
mod folders). A session picks it up when the app starts its process: a new session, or an idle one on its
next message. A process already running when the setting changed never does.

In a terminal session the app's `ccd_session_mgmt` server is absent: the first rename fails
with "no connected MCP tool", is logged once, and the mod stays quiet. A desktop session
(`CLAUDE_CODE_ENTRYPOINT=claude-desktop`) resumed with history fails the same way at start,
because the server connects later; there the 10-second tick retries until it is up.

## Desktop widget

Each state change also writes `~/.claude/state/beacon/<engine session id>.json`, which
`widget/` lists in a floating macOS panel. Setup, behaviour and the facts behind it:
[widget/README.md](widget/README.md).

## Options (`pluginConfigs.beacon.options`)

| Option | Default | Meaning |
| --- | --- | --- |
| `slowSeconds` | `60` | foreground tool call length that turns 🔵 into ⏳ |
| `staleMinutes` | `60` | how long a ⏳ session may wait for its wake-up before it turns ⚠️ (keep it above the longest wait you expect a session to schedule) |
| `classify` | `false` | ask the small model when the heuristics cannot read a long reply |
| `markUnread` | `true` | set the sidebar's unread dot when a turn settles |
| `debugLog` | `""` | absolute path for the mod's diagnostics; each session writes its own file, the first 8 characters of its id inserted before `.log` |

## Limits

- The rename is an MCP call made under your own PreToolUse hooks. A hook that denies a repeated
  identical MCP call refuses the first attempt; the mod retries once. Exempt
  `ccd_session_mgmt__get_session` and `ccd_session_mgmt__set_session_title` from such a hook to
  save the extra calls.
- A reload of the mod (an edit, a lost hooks worker) keeps the background task ids in host
  state (`$.state`, `beacon.pending`) and rereads the last reply, but not how the last turn
  ended: a ⚠️ session shows ✅ or ❓ until its next turn. A new process starts with no ids,
  as its tasks died with the old one.
- A session card's fate is not visible to the mod: a card started or left alone after the turn
  keeps ❓ until the session's next turn. The open-card count is lost on a reload.
- Background task ids are read only from Bash and Agent results; any other tool's output may
  quote the announcement text.
- A rename at `session.end` fails when the process is already unbound from the app, so a
  closed session can keep 🔵 or ⏳ until it is opened again.
- The glyph is not written before the app has generated the session's title, during a new
  session's first turn; it follows within one 10-second tick.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
