const API_BASE = '/api';

interface SendMessageResponse {
  reply: string;
  sessionId: string;
  suggestions: string[];
}

interface UploadResponse {
  documentId: string;
  jobId: string;
  status: string;
}

interface PollResponse {
  status: string;
  extractedData: ExtractedField[];
}

export interface ExtractedField {
  fieldName: string;
  fieldValue: string;
  confidence: number;
  rawValue: string;
  page: number;
}

// ─── Chat ───────────────────────────────────────────────
export async function sendMessage(sessionId: string | null, message: string): Promise<SendMessageResponse> {
  const res = await fetch(`${API_BASE}/chat/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok) throw new Error(`Chat-Fehler: ${res.status}`);
  return res.json();
}

// ─── Document Upload ────────────────────────────────────
export async function uploadDocument(file: File, documentType: string, schemaId?: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('documentType', documentType);
  if (schemaId) formData.append('schemaId', schemaId);

  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload-Fehler: ${res.status}`);
  return res.json();
}

// ─── Document Poll ──────────────────────────────────────
export async function pollDocumentStatus(documentId: string): Promise<PollResponse> {
  const res = await fetch(`${API_BASE}/documents/pollJobStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId }),
  });
  if (!res.ok) throw new Error(`Poll-Fehler: ${res.status}`);
  return res.json();
}

// ─── HCM ────────────────────────────────────────────────
export async function getEmployeeData(personnelNumber: string) {
  const res = await fetch(`${API_BASE}/hcm/getEmployeeData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personnelNumber }),
  });
  if (!res.ok) throw new Error(`HCM-Fehler: ${res.status}`);
  return res.json();
}

export async function validateHCMAction(actionType: string, payload: object) {
  const res = await fetch(`${API_BASE}/hcm/validateAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType, payload: JSON.stringify(payload) }),
  });
  if (!res.ok) throw new Error(`Validierung-Fehler: ${res.status}`);
  return res.json();
}

export async function submitHCMAction(actionType: string, employeeId: string, payload: object) {
  const res = await fetch(`${API_BASE}/hcm/submitAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType, employeeId, payload: JSON.stringify(payload) }),
  });
  if (!res.ok) throw new Error(`Submit-Fehler: ${res.status}`);
  return res.json();
}
