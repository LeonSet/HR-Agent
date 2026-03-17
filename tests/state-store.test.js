/**
 * Tests: state-store – DB-basiertes Workflow State Management
 *
 * Testet loadState, saveState, cancelState ohne echte DB-Verbindung.
 * Nutzt Mocking für CDS-Operationen.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('state-store', () => {

  // Da state-store.js CDS benötigt und wir keinen echten DB-Kontext haben,
  // testen wir die Logik über den Contract:
  // - loadState(null) → null
  // - saveState(null, ...) → no-op
  // - cancelState(null) → no-op

  it('loadState(null) should return null', async () => {
    // state-store erwartet CDS-Kontext, aber null sessionId → sofort null
    const { loadState } = require('../srv/lib/state-store');
    const result = await loadState(null);
    assert.equal(result, null);
  });

  it('loadState(undefined) should return null', async () => {
    const { loadState } = require('../srv/lib/state-store');
    const result = await loadState(undefined);
    assert.equal(result, null);
  });

  it('saveState(null, ...) should not throw', async () => {
    const { saveState } = require('../srv/lib/state-store');
    // Should be a no-op when caseId is null
    await saveState(null, { productId: 'fibu24', state: 'intake', data: {} });
  });

  it('cancelState(null) should not throw', async () => {
    const { cancelState } = require('../srv/lib/state-store');
    await cancelState(null);
  });
});
