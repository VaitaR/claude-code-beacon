import { expect, test } from 'claude-code/testing'

import { inFlightTasks, isPlaceholderTitle, isSlow, parseConfig, stripGlyph, titleOf, verdictOf, withGlyph } from '../hooks/core'

test('a glyph is prefixed once and stripped clean', () => {
  expect(withGlyph('Fix the parser', 'working')).toBe('🟢 Fix the parser')
  expect(withGlyph('🟢 Fix the parser', 'needs-you')).toBe('❓ Fix the parser')
  expect(withGlyph('⏳ Fix the parser', null)).toBe('Fix the parser')
  expect(stripGlyph('✅ Done thing')).toBe('Done thing')
  expect(stripGlyph('No glyph here')).toBe('No glyph here')
})

test('a reply that asks the person reads as needs-you', () => {
  expect(verdictOf('Both options work. Which one do you prefer?')).toBe('needs-you')
  expect(verdictOf('The PR is green.\n\nShould I merge it now, or wait for the second review?')).toBe('needs-you')
  expect(verdictOf('Tests pass. Let me know if you want the migration squashed.')).toBe('needs-you')
  expect(verdictOf('Все готово.\n\nПодтверди, что можно мержить.')).toBe('needs-you')
  expect(verdictOf('Done with step one.\n\nNEEDS YOU: pick the retention window (7d or 30d).')).toBe('needs-you')
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

test('config, titles and the MCP result', () => {
  expect(parseConfig({})).toEqual({ slowMs: 60_000, classify: true, debugLog: '' })
  expect(parseConfig({ slowSeconds: 1, classify: false, debugLog: '/tmp/b.log' })).toEqual({ slowMs: 5_000, classify: false, debugLog: '/tmp/b.log' })
  expect(titleOf({ content: [{ type: 'text', text: '{"title":"Hello"}' }] })).toBe('Hello')
  expect(titleOf({ content: [{ type: 'text', text: 'not json' }] })).toBe(null)
  expect(isPlaceholderTitle('New session')).toBe(true)
  expect(isPlaceholderTitle('🟢 New session')).toBe(true)
  expect(isPlaceholderTitle('Fix IBC Eureka')).toBe(false)
})
