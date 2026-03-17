/**
 * State Store – DB-basierte Workflow-State-Verwaltung
 *
 * Ersetzt die fragile [WORKFLOW_STATE:...]-Serialisierung in Chat-Nachrichten.
 * Workflow-State wird jetzt in der Cases-Tabelle persistiert.
 *
 * Vorteile gegenüber Message-basiertem State:
 *   - Keine Regex-Parsing-Fragilität
 *   - Abfragbar (z.B. "Alle offenen Workflows")
 *   - Crash-sicher (DB-Transaktion)
 *   - Sauber getrennt von der Chat-Historie
 */

const cds = require('@sap/cds');

/**
 * Lädt den aktiven Workflow-State für eine Session.
 *
 * Sucht den neuesten Case der Session, der einen aktiven Workflow hat.
 * "Aktiv" = workflowState ist gesetzt und nicht 'done' oder 'cancelled'.
 *
 * @param {string} sessionId - Chat-Session-ID
 * @returns {Promise<{ caseId, productId, state, documentId, data } | null>}
 */
async function loadState(sessionId) {
  if (!sessionId) return null;
  const { Cases } = cds.entities('hr.agent');

  // Neuester Case dieser Session
  const latestCase = await SELECT.one.from(Cases)
    .where({ session_ID: sessionId })
    .orderBy('modifiedAt desc');

  if (!latestCase?.workflowState ||
      latestCase.workflowState === 'done' ||
      latestCase.workflowState === 'cancelled') {
    return null;
  }

  let data = {};
  try { data = JSON.parse(latestCase.workflowData || '{}'); } catch { /* corrupt data → empty */ }

  return {
    caseId: latestCase.ID,
    productId: latestCase.productId,
    state: latestCase.workflowState,
    documentId: data._documentId || null,
    data,
  };
}

/**
 * Speichert den Workflow-State in die Cases-Tabelle.
 *
 * @param {string} caseId - Case-ID (muss bereits existieren)
 * @param {object} stateObj - { productId, state, documentId, data, caseId }
 * @param {string} [sessionId] - Session-ID (setzt session_ID falls noch nicht gesetzt)
 */
async function saveState(caseId, stateObj, sessionId) {
  if (!caseId || !stateObj) return;
  const { Cases } = cds.entities('hr.agent');

  const workflowData = { ...stateObj.data };
  if (stateObj.documentId) workflowData._documentId = stateObj.documentId;

  const updateData = {
    productId: stateObj.productId,
    workflowState: stateObj.state,
    workflowData: JSON.stringify(workflowData),
  };

  // Session-Link sicherstellen (falls beim Upload nicht gesetzt)
  if (sessionId) updateData.session_ID = sessionId;

  await UPDATE(Cases, caseId).set(updateData);
}

/**
 * Setzt den Workflow-State auf 'cancelled'.
 * loadState() ignoriert cancelled States → kein aktiver Workflow mehr.
 *
 * @param {string} caseId - Case-ID
 */
async function cancelState(caseId) {
  if (!caseId) return;
  const { Cases } = cds.entities('hr.agent');
  await UPDATE(Cases, caseId).set({ workflowState: 'cancelled' });
}

module.exports = { loadState, saveState, cancelState };
