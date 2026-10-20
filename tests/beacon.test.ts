import { expect, test } from 'claude-code/testing'

import { asksInline, clockOf, cmuxOf, proposes, inFlightTasks, isPlaceholderTitle, isSlow, isStale, launchesTasks, notifiedTasks, parseConfig, sessionOf, startedTasks, statusFileName, statusRecord, stripGlyph, titleOf, verdictOf, withGlyph } from '../hooks/core'

test('a glyph is prefixed once and stripped clean', () => {
  expect(withGlyph('Fix the parser', 'working')).toBe('🔵 Fix the parser')
  expect(withGlyph('🔵 Fix the parser', 'needs-you')).toBe('❓ Fix the parser')
  expect(withGlyph('⏳ Fix the parser', null)).toBe('Fix the parser')
  expect(stripGlyph('✅ Done thing')).toBe('Done thing')
  expect(withGlyph('✅ Fix the parser', 'error')).toBe('⚠️ Fix the parser')
  expect(stripGlyph('⚠️ Fix the parser')).toBe('Fix the parser')
  expect(stripGlyph('No glyph here')).toBe('No glyph here')
})

test('a reply that asks the person reads as needs-you', () => {
  expect(verdictOf('Both options work. Which one do you prefer?')).toBe('needs-you')
  expect(verdictOf('The PR is green.\n\nShould I merge it now, or wait for the second review?')).toBe('needs-you')
  expect(verdictOf('Tests pass. Let me know if you want the migration squashed.')).toBe('needs-you')
  expect(verdictOf('Все готово.\n\nПодтверди, что можно мержить.')).toBe('needs-you')
  expect(verdictOf('Done with step one.\n\nNEEDS YOU: pick the retention window (7d or 30d).')).toBe('needs-you')
})

test('a request mentioned far above the ending does not count', () => {
  const report = `The glyph now reacts to phrases such as "should I" and "which option" in the reply. ${'Filler sentence about the change. '.repeat(14)}\n\nCommitted and verified; nothing is in flight.`
  expect(verdictOf(report)).toBe('unsure')
  expect(verdictOf('Done.\n\nShould I merge it now, or wait?\n- yes\n- no')).toBe('needs-you')
})

test('a plain report reads as done, a long unclear one as unsure', () => {
  expect(verdictOf('Fixed the off-by-one in the pager. Verified by the unit test.')).toBe('done')
  expect(verdictOf('')).toBe('done')
  expect(verdictOf(undefined)).toBe('done')
  expect(verdictOf(`${'Findings follow. '.repeat(40)}\n\nThe third option is cheaper but slower.`)).toBe('unsure')
})

test('background work and slow calls', () => {
  expect(inFlightTasks([{ status: 'running' }, { status: 'completed' }, { status: 'pending' }])).toBe(2)
  expect(inFlightTasks(undefined)).toBe(0)
  expect(isSlow({ tool: 'Bash', at: 0 }, 61_000, 60_000)).toBe(true)
  expect(isSlow({ tool: 'Agent', at: 0 }, 600_000, 60_000)).toBe(false)
  expect(isSlow(null, 600_000, 60_000)).toBe(false)
})

test('task ids are read from results and completion notices alike', () => {
  expect(startedTasks('Command running in background with ID: brkprpvpv. Output')).toEqual(['brkprpvpv'])
  expect(startedTasks('Command did not complete within its 120s timeout and was moved to the background (ID: bz49zyar7).')).toEqual(['bz49zyar7'])
  expect(startedTasks('Agent started in background. agentId: a1b2c3')).toEqual(['a1b2c3'])
  expect(startedTasks('exit=0')).toEqual([])
  expect(launchesTasks('Bash') && launchesTasks('Agent')).toBe(true)
  expect(launchesTasks('Read')).toBe(false)
  const notice = 'exit=0\n\n<task-notification>\n<task-id>brkprpvpv</task-id>\n<status>completed</status>\n</task-notification>'
  expect(notifiedTasks(notice)).toEqual(['brkprpvpv'])
  expect(notifiedTasks('plain tool output')).toEqual([])
})

test('config, titles and the MCP result', () => {
  expect(parseConfig({})).toEqual({ slowMs: 60_000, staleMs: 3_600_000, classify: false, markUnread: true, debugLog: '' })
  expect(parseConfig({ slowSeconds: 1, staleMinutes: 0, classify: true, markUnread: false, debugLog: '/tmp/b.log' })).toEqual({ slowMs: 5_000, staleMs: 60_000, classify: true, markUnread: false, debugLog: '/tmp/b.log' })
  expect(isStale(null, 10_000_000, 3_600_000)).toBe(false)
  expect(isStale(0, 3_599_000, 3_600_000)).toBe(false)
  expect(isStale(0, 3_600_000, 3_600_000)).toBe(true)
  expect(titleOf({ content: [{ type: 'text', text: '{"title":"Hello"}' }] })).toBe('Hello')
  expect(titleOf({ content: [{ type: 'text', text: 'not json' }] })).toBe(null)
  expect(isPlaceholderTitle('New session')).toBe(true)
  expect(isPlaceholderTitle('🔵 New session')).toBe(true)
  expect(isPlaceholderTitle('Fix IBC Eureka')).toBe(false)
})

test('the widget status record carries the app session and a glyph-free title', () => {
  const got = { content: [{ type: 'text', text: JSON.stringify({ sessionId: 'local_ab-1', cwd: '/r', link: 'claude://x/local_ab-1', isArchived: false, title: '🔵 T' }) }] }
  const info = sessionOf(got)
  expect(info).toEqual({ id: 'local_ab-1', cwd: '/r', link: 'claude://x/local_ab-1', archived: false })
  expect(sessionOf({ content: [{ type: 'text', text: '{"title":"no id"}' }] })).toBe(null)
  expect(sessionOf({ content: [{ type: 'text', text: 'not json' }] })).toBe(null)
  expect(JSON.parse(statusRecord(info!, '⏳ Fix it', 'needs-you', false, 5))).toEqual({ ...info, title: 'Fix it', state: 'needs-you', ended: false, updatedAt: 5 })
  expect(statusFileName('local_ab-1')).toBe('local_ab-1.json')
  expect(statusFileName('../../etc/x')).toBe('______etc_x.json')
})

test('a cmux session records where its tab is; any other session records nothing', () => {
  const env = { CMUX_WORKSPACE_ID: 'W', CMUX_SURFACE_ID: 'S', CMUX_SOCKET_PATH: '/s.sock', CMUX_SOCKET_CAPABILITY: 'v1.t' }
  const c = cmuxOf(env)
  expect(c).toEqual({ workspace: 'W', panel: 'S', socket: '/s.sock', capability: 'v1.t', bundle: 'com.cmuxterm.app' })
  expect(cmuxOf({ ...env, CMUX_PANEL_ID: 'P' })?.panel).toBe('P')
  expect(cmuxOf({ ...env, CMUX_SOCKET_CAPABILITY: undefined })).toBe(null)
  expect(cmuxOf({})).toBe(null)
  const info = { id: 'x', cwd: '/r', link: '', archived: false }
  expect(JSON.parse(statusRecord(info, 'T', 'done', false, 1, c)).cmux).toEqual(c)
  expect('cmux' in JSON.parse(statusRecord(info, 'T', 'done', false, 1))).toBe(false)
})

test('a settled state carries the clock time it settled at; a live one none', () => {
  expect(withGlyph('Fix it', 'done', '9:05')).toBe('✅ 9:05 Fix it')
  expect(withGlyph('✅ 9:05 Fix it', 'working', '9:07')).toBe('🔵 Fix it')
  expect(withGlyph('🔵 Fix it', 'needs-you', '14:30')).toBe('❓ 14:30 Fix it')
  // A reload passes no stamp and keeps the one the title already has.
  expect(withGlyph('❓ 14:30 Fix it', 'done')).toBe('✅ 14:30 Fix it')
  expect(withGlyph('✅ Fix it', 'done')).toBe('✅ Fix it')
  expect(stripGlyph('⚠️ 23:59 Fix it')).toBe('Fix it')
  // A time that is the title's own, with no glyph before it, is kept.
  expect(stripGlyph('10:00 standup notes')).toBe('10:00 standup notes')
  expect(withGlyph('10:00 standup notes', 'done', '9:05')).toBe('✅ 9:05 10:00 standup notes')
  expect(clockOf(new Date(2026, 9, 20, 9, 5).getTime())).toBe('9:05')
})

test('a session card in the app UI is a question to the person', () => {
  expect(asksInline('AskUserQuestion', {})).toBe(true)
  expect(asksInline('mcp__ccd_session__start_session', { initiation: 'offer' })).toBe(true)
  expect(asksInline('mcp__ccd_session__start_session', { initiation: 'user_asked' })).toBe(false)
  expect(asksInline('mcp__ccd_session__start_session', { initiation: 'own_initiative' })).toBe(false)
  expect(proposes('mcp__ccd_session__start_session', { initiation: 'own_initiative' })).toBe(true)
  expect(proposes('mcp__ccd_session__start_session', { initiation: 'offer' })).toBe(false)
  expect(asksInline('Bash', { initiation: 'offer' })).toBe(false)
})
