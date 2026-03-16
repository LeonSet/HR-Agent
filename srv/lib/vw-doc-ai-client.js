/**
 * vw-doc-ai M2M Client
 *
 * Implementiert OAuth2 Client Credentials Flow und alle relevanten API-Aufrufe
 * gemäß dem VW Doc AI M2M Integration Guide.
 *
 * Konfiguration über Umgebungsvariablen oder CDS Environment:
 *   VW_DOCAI_URL          – CAP Backend URL (https://vw-doc-ai-srv.cfapps.eu10-004.hana.ondemand.com)
 *   VW_DOCAI_XSUAA_URL    – XSUAA Token-Endpoint (https://...authentication.eu10.hana.ondemand.com)
 *   VW_DOCAI_CLIENT_ID     – OAuth2 client_id
 *   VW_DOCAI_CLIENT_SECRET – OAuth2 client_secret
 *   VW_DOCAI_CLIENT_APP_ID – clientId für Mandantentrennung (z.B. "hr-agent")
 */

const API_BASE_PATH = '/document-information-extraction/v1';

// ─── Token Cache ────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

function getConfig() {
  return {
    backendUrl:   process.env.VW_DOCAI_URL          || 'https://vw-doc-ai-srv.cfapps.eu10-004.hana.ondemand.com',
    xsuaaUrl:     process.env.VW_DOCAI_XSUAA_URL    || 'https://vw-ag-hr-digital-services-dev.authentication.eu10.hana.ondemand.com',
    clientId:     process.env.VW_DOCAI_CLIENT_ID     || '',
    clientSecret: process.env.VW_DOCAI_CLIENT_SECRET || '',
    appClientId:  process.env.VW_DOCAI_CLIENT_APP_ID || 'hr-agent',
  };
}

/**
 * OAuth2 Client Credentials Token holen (mit Cache)
 */
async function getToken() {
  // Aus Cache, solange noch > 60s gültig
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('vw-doc-ai: VW_DOCAI_CLIENT_ID und VW_DOCAI_CLIENT_SECRET müssen konfiguriert sein');
  }

  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${cfg.xsuaaUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vw-doc-ai Token-Fehler (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Generischer API-Call gegen vw-doc-ai Backend
 */
async function api(method, path, body) {
  const cfg = getConfig();
  const token = await getToken();
  const url = `${cfg.backendUrl}${API_BASE_PATH}${path}`;

  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}` },
  };

  if (body && body.constructor && body.constructor.name === 'FormData') {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  // Token abgelaufen → einmal retry
  if (res.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    const newToken = await getToken();
    opts.headers['Authorization'] = `Bearer ${newToken}`;
    const retryRes = await fetch(url, opts);
    return retryRes.json();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vw-doc-ai API-Fehler (${res.status} ${method} ${path}): ${text}`);
  }

  return res.json();
}

// ─── Document API ───────────────────────────────────────

/**
 * Dokument hochladen und Extraktions-Job starten
 * @param {Buffer} fileBuffer - Datei als Buffer
 * @param {string} fileName - Original-Dateiname
 * @param {string} mimeType - MIME-Type (application/pdf, image/png, etc.)
 * @param {object} options - { documentType, schemaId, schemaVersion }
 * @returns {{ id: string, status: string }}
 */
async function uploadDocument(fileBuffer, fileName, mimeType, options = {}) {
  const cfg = getConfig();
  const token = await getToken();

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  formData.append('options', JSON.stringify({
    clientId: cfg.appClientId,
    documentType: options.documentType || 'custom',
    ...(options.schemaId && { schemaId: options.schemaId }),
    ...(options.schemaVersion && { schemaVersion: options.schemaVersion }),
  }));

  const url = `${cfg.backendUrl}${API_BASE_PATH}/document/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vw-doc-ai Upload-Fehler (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Job-Status und Extraktionsergebnis abrufen
 * @param {string} jobId
 * @returns {object} Job-Objekt mit status, extraction, etc.
 */
async function getJobStatus(jobId) {
  return api('GET', `/document/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * Pollen bis Job DONE oder FAILED
 * @param {string} jobId
 * @param {number} intervalMs - Poll-Intervall (Default: 3000ms)
 * @param {number} maxAttempts - Max. Versuche (Default: 30)
 * @returns {object} Fertiges Job-Ergebnis
 */
async function pollUntilDone(jobId, intervalMs = 3000, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const result = await getJobStatus(jobId);
    if (result.status === 'DONE') return result;
    if (result.status === 'FAILED') {
      throw new Error(`Extraktion fehlgeschlagen: ${result.error?.message || 'Unbekannter Fehler'}`);
    }
  }
  throw new Error(`Timeout: Extraktion für Job ${jobId} dauert zu lange (>${maxAttempts * intervalMs / 1000}s)`);
}

/**
 * Alle Jobs auflisten
 */
async function listJobs() {
  const cfg = getConfig();
  return api('GET', `/document/jobs?clientId=${encodeURIComponent(cfg.appClientId)}`);
}

/**
 * Extraktionsergebnis genehmigen
 */
async function approveJob(jobId, comment) {
  return api('POST', `/document/jobs/${encodeURIComponent(jobId)}/approve`, { comment });
}

/**
 * Extraktionsergebnis ablehnen
 */
async function rejectJob(jobId, comment) {
  return api('POST', `/document/jobs/${encodeURIComponent(jobId)}/reject`, { comment });
}

// ─── Schema API ─────────────────────────────────────────

/**
 * Schema erstellen
 */
async function createSchema(name, documentType, description) {
  const cfg = getConfig();
  return api('POST', '/schemas', {
    clientId: cfg.appClientId,
    name,
    schemaDescription: description || '',
    documentType: documentType || 'custom',
  });
}

/**
 * Felder zu einer Schema-Version hinzufügen
 */
async function addSchemaFields(schemaId, version, headerFields, lineItemFields) {
  return api('POST', `/schemas/${encodeURIComponent(schemaId)}/versions/${version}/fields`, {
    headerFields: headerFields || [],
    lineItemFields: lineItemFields || [],
  });
}

/**
 * Alle Schemas auflisten
 */
async function listSchemas() {
  const cfg = getConfig();
  return api('GET', `/schemas?clientId=${encodeURIComponent(cfg.appClientId)}`);
}

/**
 * Schema mit Versionen und Feldern abrufen
 */
async function getSchema(schemaId) {
  return api('GET', `/schemas/${encodeURIComponent(schemaId)}`);
}

/**
 * Health Check
 */
async function healthCheck() {
  const cfg = getConfig();
  const res = await fetch(`${cfg.backendUrl}/health`);
  return res.json();
}

/**
 * Prüft ob vw-doc-ai konfiguriert und erreichbar ist
 */
function isConfigured() {
  const cfg = getConfig();
  return !!(cfg.clientId && cfg.clientSecret);
}

module.exports = {
  getToken,
  uploadDocument,
  getJobStatus,
  pollUntilDone,
  listJobs,
  approveJob,
  rejectJob,
  createSchema,
  addSchemaFields,
  listSchemas,
  getSchema,
  healthCheck,
  isConfigured,
};
