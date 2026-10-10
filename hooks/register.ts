import type { EngineInterface as Engine, Register } from 'claude-code'

import {
  type Config,
  type State,
  classifyTail,
  inFlightTasks,
  isPlaceholderTitle,
  isSlow,
  isStale,
  notifiedTasks,
  parseConfig,
  type SessionInfo,
  sessionOf,
  startedTasks,
  statusFileName,
  statusRecord,
  titleOf,
  verdictOf,
  withGlyph,
} from './core'

// The desktop app's session server, as `$.mcp.call` names it. A terminal session has none: the
// first call then fails with "no connected MCP tool", logged once, and the mod goes quiet.
const SERVER = 'ccd_session_mgmt'
const NO_SERVER = /no connected MCP tool/i
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const TICK_MS = 10_000

// Module state is lost on a hot reload; session.start then runs again and recomputes it.
let cfg: Config = parseConfig({})
let state: State | null = null
let turnActive = false
let asking = false
let inFlight: { tool: string; at: number } | null = null
let waitingSince: number | null = null
let renaming: Promise<void> = Promise.resolve()
let mcpBroken = false
// A new session's title is generated during its first turn, after turn.start: the tick
// retries the rename until a title exists.
let untitled = false
// What the status file for the desktop widget needs beyond the state: the app's session id and
// link come from get_session; a terminal session (no app server) has neither. The file itself is
// named by the engine's session id, the one tools/validate.sh recognises as a live session.
let info: SessionInfo | null = null
let lastTitle: string | null = null
let ended = false
let statusDir: Promise<string | null> | null = null
const lines: string[] = []
// The file outlives a hot reload while `lines` does not: the first write seeds from its tail.
// One file per session: every session rewrites its whole file, so a shared one loses lines.
let logPath: Promise<string> | null = null

function debug($: Engine, text: string) {
  $.ui.log(`beacon: ${text}`, { to: 'debug' })
  if (cfg.debugLog === '') return
  logPath ??= $.session
    .id()
    .then(id => cfg.debugLog.replace(/(\.log)?$/, `.${id.slice(0, 8)}$1`))
    .then(path =>
      $.fs
        .read(path)
        .then(old => { lines.unshift(...old.split('\n').filter(l => l !== '').slice(-150)) })
        .catch(() => undefined)
        .then(() => path),
    )
  lines.push(`${new Date().toISOString()} ${text}`)
  void logPath.then(path => $.fs.write(path, `${lines.slice(-200).join('\n')}\n`)).catch(() => undefined)
}

// The call runs under the person's own PreToolUse hooks. One of them denies a repeated identical
// MCP call once and lets the immediate repeat through, so a refusal is retried exactly once.
async function callSession($: Engine, tool: string, args: Record<string, unknown>) {
  try {
    return await $.mcp.call(SERVER, tool, args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (NO_SERVER.test(message)) {
      mcpBroken = true
      throw err
    }
    debug($, `${tool} refused once, retrying: ${message.slice(0, 160)}`)
    return $.mcp.call(SERVER, tool, args)
  }
}

// One rename at a time, in order: two overlapping get/set pairs would race on the title.
function rename($: Engine, next: State | null) {
  renaming = renaming.then(async () => {
    if (!mcpBroken) await retitle($, next)
    await writeStatus($, next)
  })
}

async function retitle($: Engine, next: State | null) {
  try {
    const got = await callSession($, 'get_session', { session_id: 'self' })
    if (got.isError) {
      debug($, `get_session failed: ${JSON.stringify(got.content).slice(0, 200)}`)
      return
    }
    info = sessionOf(got) ?? info
    const title = titleOf(got)
    if (title !== null) lastTitle = title
    if (title === null || isPlaceholderTitle(title)) {
      if (!untitled) debug($, `no title to prefix: ${JSON.stringify(got.content).slice(0, 120)}`)
      untitled = true
      return
    }
    untitled = false
    const wanted = withGlyph(title, next)
    if (wanted === title) return
    const set = await callSession($, 'set_session_title', { session_id: 'self', title: wanted })
    if (set.isError) debug($, `set_session_title failed: ${JSON.stringify(set.content).slice(0, 200)}`)
    else debug($, `title set: ${wanted}`)
  } catch (err) {
    debug($, `rename failed${mcpBroken ? ', going quiet' : ''}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function writeStatus($: Engine, next: State | null) {
  try {
    statusDir ??= $.env.get('HOME').then(home => (home ? `${home}/.claude/state/beacon` : null))
    const dir = await statusDir
    if (dir === null) return
    if (info === null && mcpBroken) {
      info = { id: await $.session.id(), cwd: await $.session.cwd(), link: '', archived: false }
    }
    if (info === null) return
    const title = lastTitle ?? info.cwd.split('/').pop() ?? ''
    const file = statusFileName(await $.session.id())
    await $.fs.write(`${dir}/${file}`, statusRecord(info, title, next, ended, Date.now()))
  } catch (err) {
    debug($, `status write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function publish($: Engine, next: State | null) {
  if (next === state) return
  state = next
  waitingSince = next === 'waiting' ? Date.now() : null
  rename($, next)
}

async function settle($: Engine, answer: string | undefined) {
  let verdict = verdictOf(answer)
  if (verdict === 'unsure') {
    verdict = 'done'
    if (cfg.classify && answer) {
      try {
        const label = await $.model.classify(classifyTail(answer), [
          'asks-the-user-a-question-or-for-a-decision',
          'reports-without-needing-a-reply',
        ])
        if (label === 'asks-the-user-a-question-or-for-a-decision') verdict = 'needs-you'
      } catch (err) {
        debug($, `classify failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  publish($, verdict)
}

function endTurn() {
  turnActive = false
  asking = false
  inFlight = null
}

// Background work the main loop started and has not yet been notified about: ids from the Bash
// and Agent results, cleared by the completion notice. That notice is a prompt.submit of
// origin `task-notification`: the next turn's text when the session is idle, a mid-turn
// submission when it is not (it never shows in a tool result).
const pending = new Set<string>()
const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])

async function inFlightCount($: Engine) {
  let agents = 0
  try {
    agents = (await $.agent.list()).filter(a => LIVE_AGENT.has(a.status) && !pending.has(a.id)).length
  } catch (err) {
    debug($, `agent.list failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return pending.size + agents
}

// The end of a main-loop turn: what is still running decides between waiting and a verdict.
async function finish($: Engine, answer: string | undefined, via: string) {
  endTurn()
  const count = await inFlightCount($)
  debug($, `${via}: pending=${count} ids=${[...pending].join(',')} answer=${(answer ?? '').length} chars`)
  if (count > 0) publish($, 'waiting')
  else await settle($, answer)
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    const messages = await $.session.messages()
    const lastAnswer = [...messages].reverse().find(m => m.role === 'assistant')?.text
    debug($, `loaded: ${messages.length} messages, pending cleared`)
    if (messages.length > 0) await settle($, lastAnswer)
    $.clock.every(TICK_MS, () => {
      const now = Date.now()
      if (untitled && state !== null) rename($, state)
      if (turnActive && !asking && isSlow(inFlight, now, cfg.slowMs)) publish($, 'waiting')
      // A wake-up that has not come within the hour is not coming: the wait is broken, not long.
      if (!turnActive && state === 'waiting' && isStale(waitingSince, now, cfg.staleMs)) {
        debug($, `waiting ${Math.round((now - (waitingSince ?? now)) / 60_000)} min, ids=${[...pending].join(',')}: stale`)
        publish($, 'error')
      }
    })
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    const ids = notifiedTasks(e.text)
    for (const id of ids) pending.delete(id)
    if (ids.length > 0) debug($, `notified ${e.origin.kind}${e.turnId === undefined ? '' : ' mid-turn'}: ${ids.join(',')}`)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    turnActive = true
    asking = false
    inFlight = null
    for (const id of notifiedTasks(e.text)) pending.delete(id)
    publish($, 'working')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const tool = String(e.tool)
    inFlight = { tool, at: Date.now() }
    if (ASKING_TOOLS.has(tool)) {
      asking = true
      publish($, 'needs-you')
    }
    if (e.tool === 'TaskStop' && e.task_id !== undefined) pending.delete(e.task_id)
    const ran = await next(e)
    inFlight = null
    if (ran.deny === undefined && ran.isError !== true) {
      const text = `${ran.text ?? ''}\n${typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? '')}`
      for (const id of startedTasks(text)) pending.add(id)
    }
    if (asking) {
      asking = false
      if (turnActive) publish($, 'working')
    } else if (turnActive && state === 'waiting') {
      publish($, 'working')
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId === undefined && verdict.decision === 'ask') {
      asking = true
      publish($, 'needs-you')
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', ($, e, next) => {
    if (e.agent_id === undefined) {
      asking = true
      publish($, 'needs-you')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The desktop app was not seen to raise classic.Stop; turn.complete is the trigger that fires.
  // Stop stays hooked for builds that do raise it: its task list is authoritative there.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e)
    const listed = inFlightTasks(e.background_tasks) + (e.session_crons?.length ?? 0)
    if (listed > 0) {
      endTurn()
      publish($, 'waiting')
    } else await finish($, e.last_assistant_message, 'Stop')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // An interrupt is the person's own doing and needs no flag; an API error, rate limit or
    // overflow ended the work unfinished and would otherwise pass as done.
    if (e.reason === 'aborted' || e.reason === 'error') {
      endTurn()
      publish($, e.reason === 'error' ? 'error' : 'done')
    } else await finish($, e.answer, `turn.complete(${e.reason})`)
    return next(e)
  })

  on('session.end', ($, e, next) => {
    // A closed session keeps a verdict glyph (still true of its transcript) but not a live one.
    ended = true
    if (e.reason === 'clear' || state === 'working' || state === 'waiting') publish($, null)
    else rename($, state)
    return next(e)
  })
}
