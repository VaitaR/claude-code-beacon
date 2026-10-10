import { expect, test } from 'claude-code/testing'

import { inFlightTasks, isPlaceholderTitle, isSlow, isStale, notifiedTasks, parseConfig, startedTasks, stripGlyph, titleOf, verdictOf, withGlyph } from '../hooks/core'

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
  const notice = 'exit=0\n\n<task-notification>\n<task-id>brkprpvpv</task-id>\n<status>completed</status>\n</task-notification>'
  expect(notifiedTasks(notice)).toEqual(['brkprpvpv'])
  expect(notifiedTasks('plain tool output')).toEqual([])
})

test('config, titles and the MCP result', () => {
  expect(parseConfig({})).toEqual({ slowMs: 60_000, staleMs: 3_600_000, classify: false, debugLog: '' })
  expect(parseConfig({ slowSeconds: 1, staleMinutes: 0, classify: true, debugLog: '/tmp/b.log' })).toEqual({ slowMs: 5_000, staleMs: 60_000, classify: true, debugLog: '/tmp/b.log' })
  expect(isStale(null, 10_000_000, 3_600_000)).toBe(false)
  expect(isStale(0, 3_599_000, 3_600_000)).toBe(false)
  expect(isStale(0, 3_600_000, 3_600_000)).toBe(true)
  expect(titleOf({ content: [{ type: 'text', text: '{"title":"Hello"}' }] })).toBe('Hello')
  expect(titleOf({ content: [{ type: 'text', text: 'not json' }] })).toBe(null)
  expect(isPlaceholderTitle('New session')).toBe(true)
  expect(isPlaceholderTitle('🔵 New session')).toBe(true)
  expect(isPlaceholderTitle('Fix IBC Eureka')).toBe(false)
})
