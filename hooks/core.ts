// Pure data: the state table, the title glyph, and the reading of a reply's ending.
// Nothing here touches `$`, so every rule is testable directly.

export type State = 'working' | 'waiting' | 'needs-you' | 'done'

export const GLYPH: Record<State, string> = {
  working: '🟢',
  waiting: '⏳',
  'needs-you': '❓',
  done: '✅',
}

// Every glyph this mod ever wrote, so a title written by an older version still strips clean.
const LEADING_GLYPH = /^(?:🟢|⏳|❓|✅|🔴|⏸)️?\s*/u

export const stripGlyph = (title: string) => title.replace(LEADING_GLYPH, '')

export const withGlyph = (title: string, state: State | null) => {
  const base = stripGlyph(title).trim()
  return state === null ? base : `${GLYPH[state]} ${base}`
}

export type Config = { slowMs: number; classify: boolean; debugLog: string }

export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => ({
  slowMs: Math.max(5, typeof o.slowSeconds === 'number' ? o.slowSeconds : 60) * 1000,
  classify: typeof o.classify === 'boolean' ? o.classify : true,
  debugLog: typeof o.debugLog === 'string' ? o.debugLog : '',
})

export type Verdict = 'needs-you' | 'done' | 'unsure'

// The explicit convention (core.md, "Answer shape"): a reply that needs the person ends with this line.
const MARKER = /^\s*(?:[*_#>\-\s]*)(?:NEEDS YOU|NEED(?:S)? YOUR (?:DECISION|ANSWER|INPUT|CONFIRMATION|APPROVAL))\b/im

// Phrasings of a request for a decision that do not end in a question mark.
const ASKING_EN =
  /\b(?:should i|shall i|do you want(?: me)?|want me to|would you like|let me know (?:if|whether|which|when)|which (?:option|one|approach|way)|your call|up to you|please (?:approve|confirm|choose|decide|pick|review)|waiting for (?:your|you)|awaiting your|need(?:s)? your (?:approval|decision|confirmation|go-ahead|ok)|confirm (?:before|that|whether|the)|say the word|give me the go-ahead|choose (?:one|between))\b/i
// Cyrillic kept literal on purpose: these are match patterns, listed in tools/cyrillic-allowed.txt.
const ASKING_RU =
  /(?:подтверди|подтвержден|продолж(?:ать|ить)\s*\?|хочешь|хотите|нужно ли|стоит ли|какой (?:вариант|подход|из)|выбери|выберите|жду (?:твоего|вашего|подтверждения|ответа|решения|отмашки)|тво[её] решение|ваше решение|реши(?:те)?,|скажи(?:те)?,? (?:если|какой|что|как)|дай(?:те)? (?:знать|добро)|нужно (?:тво[её]|ваше) (?:решение|подтверждение))/i

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
  const t = (text ?? '').trim()
  if (t === '') return 'done'
  const tail = lastLines(t, 6)
  if (tail.length === 0) return 'done'
  if (MARKER.test(tail.join('\n'))) return 'needs-you'
  const last = tail[tail.length - 1] ?? ''
  if (/\?\s*(?:\*\*|_)?\s*$/.test(last)) return 'needs-you'
  const end = tail.slice(-3).join('\n')
  if (ASKING_EN.test(end) || ASKING_RU.test(end)) return 'needs-you'
  if (t.length < 400) return 'done'
  return 'unsure'
}

/** The text a classifier reads: the reply's last 1,500 characters, enough for its closing paragraph. */
export const classifyTail = (text: string) => text.trim().slice(-1500)

const ENDED = new Set(['completed', 'failed', 'killed', 'done', 'cancelled', 'canceled', 'stopped'])

/** Background tasks still in flight when a turn ends, by the Stop hook's own summary list. */
export const inFlightTasks = (tasks: ReadonlyArray<{ status: string }> | undefined) =>
  (tasks ?? []).filter(t => !ENDED.has(String(t.status).toLowerCase())).length

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

// Titles the app has not named yet: renaming one would freeze it before the app's own title lands.
export const isPlaceholderTitle = (title: string) => /^(?:new session|untitled|new conversation)$/i.test(stripGlyph(title).trim())
