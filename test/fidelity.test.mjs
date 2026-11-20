import test from 'node:test'
import assert from 'node:assert/strict'
import { FIDELITY_RESULTS, FIDELITY_TESTED_AT, fidelityFor } from '../src/fidelity.mjs'

test('fidelity data covers all themes with plausible scores', () => {
  assert.ok(FIDELITY_TESTED_AT.startsWith('2026-'))
  assert.equal(Object.keys(FIDELITY_RESULTS).length, 13)
  for (const [themeId, row] of Object.entries(FIDELITY_RESULTS)) {
    assert.ok(row.score >= 90 && row.score <= 100, themeId)
    assert.equal(row.ok, true, themeId)
    assert.equal(row.scriptFree, true, themeId)
  }
  assert.equal(fidelityFor('column').themeId, 'column')
  assert.equal(fidelityFor('missing-theme'), null)
})
