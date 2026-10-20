// Pure data: the state table, the title glyph, and the reading of a reply's ending.
// Nothing here touches `$`, so every rule is testable directly.

export type State = 'working' | 'waiting' | 'needs-you' | 'done' | 'error'

// Blue for the live state: a green dot sat next to the green check and read as the same thing.
export const GLYPH: Record<State, string> = {
  working: '🔵',
  waiting: '⏳',
  'needs-you': '❓',
  done: '✅',
  error: '⚠️',
}

// Every glyph this mod ever wrote, so a title written by an older version still strips clean. The
// clock stamp is stripped only behind a glyph: a title of its own may start with a time.
const LEADING_GLYPH = /^(?:🔵|🟢|⏳|❓|✅|⚠|🔴|⏸)️?\s*(?:\d{1,2}:\d{2}\s+)?/u
const STAMP = /^(?:🔵|🟢|⏳|❓|✅|⚠|🔴|⏸)️?\s*(\d{1,2}:\d{2})\s/u

export const stripGlyph = (title: string) => title.replace(LEADING_GLYPH, '')

// Live states change too often to stamp; a settled one keeps the time it settled at.
const STAMPED = new Set<State>(['needs-you', 'done', 'error'])

/** The local `H:MM` a settled state is stamped with. A title cannot tick, so a clock time, not an age. */
export const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `stamp` undefined keeps the title's own stamp: a reload re-reads a state, it did not settle it again. */
export const withGlyph = (title: string, state: State | null, stamp?: string) => {
  const base = stripGlyph(title).trim()
  if (state === null) return base
  const at = STAMPED.has(state) ? (stamp ?? STAMP.exec(title)?.[1]) : undefined
  return at === undefined ? `${GLYPH[state]} ${base}` : `${GLYPH[state]} ${at} ${base}`
}

// The app's session-handoff tool. `offer` holds the call open on a "New session / Do it here"
// card; `own_initiative` leaves a card the person may start after the turn has ended.
export const START_SESSION = 'mcp__ccd_session__start_session'
export const DISMISS_TASK = 'mcp__ccd_session__dismiss_task'
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Whether a tool call is open on a question to the person in the app's own UI. */
export const asksInline = (tool: string, input: { initiation?: unknown }) =>
  ASKING_TOOLS.has(tool) || (tool === START_SESSION && input.initiation === 'offer')

/** Whether a call left a session card for the person to start or ignore. */
export const proposes = (tool: string, input: { initiation?: unknown }) =>
  tool === START_SESSION && input.initiation === 'own_initiative'

export type Config = { slowMs: number; staleMs: number; classify: boolean; markUnread: boolean; debugLog: string }

export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => ({
  slowMs: Math.max(5, typeof o.slowSeconds === 'number' ? o.slowSeconds : 60) * 1000,
  // A self-chosen wait is capped at 55 minutes by the operating rules; a session still waiting
  // past the hour has lost its wake-up, so the default sits just above that cap.
  staleMs: Math.max(1, typeof o.staleMinutes === 'number' ? o.staleMinutes : 60) * 60_000,
  // Off by default: the classifier called a long report that merely mentioned a choice a question,
  // twice in one afternoon. The marker line and the question rules are the contract.
  classify: typeof o.classify === 'boolean' ? o.classify : false,
  markUnread: typeof o.markUnread === 'boolean' ? o.markUnread : true,
  debugLog: typeof o.debugLog === 'string' ? o.debugLog : '',
})

export type Verdict = 'needs-you' | 'done' | 'unsure'

// The explicit convention (README, "How needs you is read"): a reply that needs the person ends with this line.
const MARKER = /^\s*(?:[*_#>\-\s]*)(?:NEEDS YOU|NEED(?:S)? YOUR (?:DECISION|ANSWER|INPUT|CONFIRMATION|APPROVAL))\b/im
// Text after the marker (a code block, a closing remark) pushes it out of the closing lines, so the
// marker alone is looked for over a wider stretch; anchored at line start, a quoted one never counts.
const MARKER_WINDOW = 2000

// Phrasings of a request for a decision that do not end in a question mark.
const ASKING_EN =
  /\b(?:should i|shall i|do you want(?: me)?|want me to|would you like|let me know (?:if|whether|which|when)|which (?:option|one|approach|way)|your call|up to you|please (?:approve|confirm|choose|decide|pick|review)|waiting for (?:your|you)|awaiting your|need(?:s)? your (?:approval|decision|confirmation|go-ahead|ok)|confirm (?:before|that|whether|the)|say the word|give me the go-ahead|choose (?:one|between))\b/i
// Cyrillic kept literal on purpose: these are match patterns for Russian replies. `\b` does not
// see Cyrillic letters, so the imperative ends at a lookahead: "подтвердил" is a statement.
const ASKING_RU =
  /(?:подтверди(?:те)?(?![а-яё])|продолж(?:ать|ить)\s*\?|хочешь|хотите|нужно ли|стоит ли|какой (?:вариант|подход|из)|выбери|выберите|жду (?:твоего|вашего|подтверждения|ответа|решения|отмашки)|тво[её] решение|ваше решение|реши(?:те)?,|скажи(?:те)?,? (?:если|какой|что|как)|дай(?:те)? (?:знать|добро)|нужно (?:тво[её]|ваше) (?:решение|подтверждение))/i

// A session postmortem appended after the reply proper: `friction:` first, then `key: value` lines.
const POSTMORTEM_START = /^[>*_`\-\s]*friction\s*:/i
const POSTMORTEM_LINE = /^[>*_`\-\s]*[a-z][a-z_-]{0,20}\s*:/i

/** The reply without a trailing postmortem block; unchanged unless every line after `friction:` is a key line. */
export const withoutPostmortem = (text: string) => {
  const lines = text.split('\n')
  const start = lines.findLastIndex(l => POSTMORTEM_START.test(l))
  if (start < 0) return text
  const rest = lines.slice(start).filter(l => l.trim() !== '')
  return rest.every(l => POSTMORTEM_LINE.test(l)) ? lines.slice(0, start).join('\n') : text
}

const lastLines = (text: string, n: number) =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !/^```/.test(l))
    .slice(-n)

/**
 * Reads the ending of a reply: `needs-you` when it asks the person for anything, `done` when it is
 * a plain report, `unsure` when neither rule fires (a classifier decides then).
 */
export const verdictOf = (text: string | undefined): Verdict => {
  const t = withoutPostmortem((text ?? '').trim()).trim()
  if (t === '') return 'done'
  const tail = lastLines(t, 6)
  if (tail.length === 0) return 'done'
  const window = t.length <= MARKER_WINDOW ? t : t.slice(t.indexOf('\n', t.length - MARKER_WINDOW) + 1)
  if (MARKER.test(window)) return 'needs-you'
  const last = tail[tail.length - 1] ?? ''
  if (/\?\s*(?:\*\*|_)?\s*$/.test(last)) return 'needs-you'
  // Unwrapped paragraphs are single lines, so three of them can be most of a reply: only the
  // closing stretch counts, or a report that merely describes a choice reads as asking one.
  const end = tail.slice(-3).join('\n').slice(-400)
  if (ASKING_EN.test(end) || ASKING_RU.test(end)) return 'needs-you'
  if (t.length < 400) return 'done'
  return 'unsure'
}

// The desktop app's end-of-turn tool. A turn that ends on it has no closing text (`turn.complete`
// carries an empty answer): the recap is the reply, and `ask` / `blocked` are the request.
export const WRAP_UP = 'mcp__ccd_turn__wrap_up'

export type WrapUp = { recap: string; ask: string; blocked: string }

const field = (v: unknown) => (typeof v === 'string' ? v.trim() : v === true ? 'yes' : '')

export const wrapUpOf = (input: Readonly<Record<string, unknown>>): WrapUp => ({
  recap: field(input.recap),
  ask: field(input.ask),
  blocked: field(input.blocked),
})

/** The text a turn ended on: its answer, or the wrap_up recap and ask when the answer is empty. */
export const endingOf = (answer: string | undefined, wrapUp: WrapUp | null) =>
  (answer ?? '').trim() !== '' || wrapUp === null ? answer : [wrapUp.recap, wrapUp.ask].filter(s => s !== '').join('\n\n')

/** The verdict of a whole turn: a wrap_up that asks or is blocked needs the person outright. */
export const turnVerdictOf = (answer: string | undefined, wrapUp: WrapUp | null): Verdict =>
  wrapUp !== null && (wrapUp.ask !== '' || wrapUp.blocked !== '') ? 'needs-you' : verdictOf(endingOf(answer, wrapUp))

/**
 * The state a turn that ended without an answer settles in, or null when it answered. An interrupt
 * is the person's own doing; an API error or a refusal ended the work unfinished.
 */
export const unansweredState = (reason: string): State | null =>
  reason === 'aborted' ? 'done' : reason === 'error' || reason === 'refusal' ? 'error' : null

// No app server to call: a terminal session ("no connected MCP tool"), or a headless child that
// inherited the desktop entrypoint (an eval, a worker run) and has no session bound.
const NO_SERVER = /no connected MCP tool/i
const NO_SESSION = /no session is bound in this process/i

/** How an MCP call failure reads: the server is not there yet, never will be, or it refused this call. */
export const mcpFailureOf = (message: string): 'no-server' | 'no-session' | 'refused' =>
  NO_SESSION.test(message) ? 'no-session' : NO_SERVER.test(message) ? 'no-server' : 'refused'

/** The text a classifier reads: the reply's last 1,500 characters, enough for its closing paragraph. */
export const classifyTail = (text: string) => text.trim().slice(-1500)

const ENDED = new Set(['completed', 'failed', 'killed', 'done', 'cancelled', 'canceled', 'stopped'])

/** Background tasks still in flight when a turn ends, by the Stop hook's own summary list. */
export const inFlightTasks = (tasks: ReadonlyArray<{ status: string }> | undefined) =>
  (tasks ?? []).filter(t => !ENDED.has(String(t.status).toLowerCase())).length

// A Bash call started in the background, or moved there on timeout, and an Agent spawn name
// their task in the result text; the engine's completion notice carries it as <task-id>.
const STARTED_ID = /(?:background with ID|background \(ID|agentId): ([\w-]+)/g
const NOTIFIED_ID = /<task-id>([\w-]+)<\/task-id>/g
const idsIn = (text: string, re: RegExp) => [...text.matchAll(re)].map(m => m[1] ?? '').filter(Boolean)

// Only these tools start background work. Any other result can quote the announcement (a Read of
// this mod's own tests did), and a phantom id holds the session in waiting until it goes stale.
const LAUNCHERS = new Set(['Bash', 'Agent', 'Task'])
export const launchesTasks = (tool: string) => LAUNCHERS.has(tool)

/** Task ids a tool result announces as started in the background. */
export const startedTasks = (text: string) => idsIn(text, STARTED_ID)

/** Task ids a completion notice names; it arrives in a turn's opening text or inside a tool
 *  result, whichever the model was in when the task ended. */
export const notifiedTasks = (text: string) => idsIn(text, NOTIFIED_ID)

/** Whether a session that ended its turn waiting has waited past the point where a wake-up is still expected. */
export const isStale = (waitingSince: number | null, now: number, staleMs: number) =>
  waitingSince !== null && now - waitingSince >= staleMs

/** Whether a foreground call has run long enough to count as waiting rather than working. */
export const isSlow = (call: { tool: string; at: number } | null, now: number, slowMs: number) =>
  call !== null && call.tool !== 'Agent' && call.tool !== 'Task' && now - call.at >= slowMs

/** The title an MCP `get_session` result carries, or null when the result cannot be read. */
export const titleOf = (result: { content: ReadonlyArray<{ type: string; text?: string }> }): string | null => {
  const text = result.content.find(c => c.type === 'text')?.text
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { title?: unknown }
    return typeof parsed.title === 'string' && parsed.title.trim() !== '' ? parsed.title : null
  } catch {
    return null
  }
}

export type SessionInfo = { id: string; cwd: string; link: string; archived: boolean }

/** The identity fields of a `get_session` result, or null when it carries no session id. */
export const sessionOf = (result: { content: ReadonlyArray<{ type: string; text?: string }> }): SessionInfo | null => {
  const text = result.content.find(c => c.type === 'text')?.text
  if (!text) return null
  try {
    const p = JSON.parse(text) as { sessionId?: unknown; cwd?: unknown; link?: unknown; isArchived?: unknown }
    if (typeof p.sessionId !== 'string' || p.sessionId === '') return null
    return {
      id: p.sessionId,
      cwd: typeof p.cwd === 'string' ? p.cwd : '',
      link: typeof p.link === 'string' ? p.link : '',
      archived: p.isArchived === true,
    }
  } catch {
    return null
  }
}

/**
 * The line a status file holds for the desktop widget (`widget/`). The file name is the id with
 * every character outside `[A-Za-z0-9_-]` replaced, so an id can never escape the directory.
 */
export const statusFileName = (id: string) => `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`

/**
 * Where a session started inside the cmux terminal lives, so the widget can focus its tab. cmux's
 * socket admits only processes started inside cmux; the capability token cmux hands those
 * processes is what lets the widget, started outside it, through.
 */
export type CmuxInfo = { workspace: string; panel: string; socket: string; capability: string; bundle: string }

export const cmuxOf = (env: Readonly<Record<string, string | undefined>>): CmuxInfo | null => {
  const workspace = env.CMUX_WORKSPACE_ID ?? ''
  const panel = env.CMUX_PANEL_ID ?? env.CMUX_SURFACE_ID ?? ''
  const capability = env.CMUX_SOCKET_CAPABILITY ?? ''
  if (workspace === '' || panel === '' || capability === '') return null
  return { workspace, panel, socket: env.CMUX_SOCKET_PATH ?? '', capability, bundle: env.CMUX_BUNDLE_ID ?? 'com.cmuxterm.app' }
}

export const statusRecord = (
  info: SessionInfo,
  title: string,
  state: State | null,
  ended: boolean,
  now: number,
  cmux: CmuxInfo | null = null,
) => `${JSON.stringify({ ...info, title: stripGlyph(title), state, ended, updatedAt: now, ...(cmux ? { cmux } : {}) })}\n`

// Titles the app has not named yet: renaming one would freeze it before the app's own title lands.
export const isPlaceholderTitle = (title: string) => /^(?:new session|untitled|new conversation)$/i.test(stripGlyph(title).trim())
