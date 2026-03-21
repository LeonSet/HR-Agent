# API-Referenz

> **Basis-URL:** `http://localhost:4004/api`  
> **Protokoll:** HTTP/REST (CDS Actions + Express-Middleware)  
> **Content-Type:** `application/json` (außer Upload: `multipart/form-data`)  
> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [FRONTEND.md](FRONTEND.md) · [DATA_MODEL.md](DATA_MODEL.md)

---

## 1. Übersicht

Das Backend exponiert **3 CDS-Services** + **2 Express-Routen**:

| Service | Pfad | Implementierung | Zweck |
|---------|------|----------------|-------|
| ChatService | `/api/chat` | `srv/chat-service.js` | Chat mit Agent-Loop |
| DocumentService | `/api/documents` | `srv/document-service.js` | Dokument-Metadaten & Polling |
| HCMService | `/api/hcm` | `srv/hcm-service.js` | Mitarbeiterdaten & HR-Aktionen |
| *(Express)* | `/api/documents/upload` | `server.js` | Datei-Upload (Multer) |
| *(Express)* | `/api/documents/startExtraction` | `server.js` | Schema-Extraktion starten |

**Wichtig:** Die Express-Routen werden vor den CDS-Services registriert (via `cds.on('bootstrap')`) und haben Vorrang.

---

## 2. ChatService (`/api/chat`)

### 2.1 `POST /api/chat/sendMessage`

Zentrale Chat-Schnittstelle. Orchestriert den Agent-Loop mit Tool-Calling.

**Request:**
```json
{
  "sessionId": "uuid-string | null",
  "message": "Wie beantrage ich Elternzeit?"
}
```

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `sessionId` | UUID \| null | Nein | Session-ID. Wenn null → neue Session wird erstellt |
| `message` | String | Ja | User-Nachricht |

**Response:**
```json
{
  "reply": "Für die Beantragung von Elternzeit...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "suggestions": ["Antrag einreichen", "Dokument hochladen", "Abbrechen"],
  "toolCalls": [
    {
      "tool": "kb_search",
      "args": "{\"query\":\"Elternzeit beantragen\"}",
      "result": "{\"found\":3,\"results\":[...]}"
    }
  ]
}
```

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `reply` | String | LLM-Antwort (Markdown) |
| `sessionId` | UUID | Session-ID (bei neuer Session: gerade erzeugt) |
| `suggestions` | String[] | Vorschläge für nächsten Schritt (0–3 Einträge) |
| `toolCalls` | ToolCall[] \| undefined | Ausgeführte Tool-Calls mit serialisierten Args/Results |

**Internes Verhalten:**

1. Session erstellen oder laden
2. User-Nachricht in `ChatMessages` speichern
3. Letzte 20 Nachrichten als History laden
4. `runAgentLoop()` aufrufen (→ Workflow-Modus oder Free-Chat-Modus)
5. Assistant-Antwort + Tool-Context in `ChatMessages` speichern
6. Suggestions ableiten (Agent-Suggestions oder regelbasiert via `deriveSuggestions`)
7. Response zusammenbauen

**Fallback-Modus:** Wenn `OPENAI_API_KEY` fehlt oder ungültig → regelbasierte Antworten (`generateFallbackResponse`), keine Tool-Calls.

---

## 3. DocumentService (`/api/documents`)

### 3.1 `POST /api/documents/upload` *(Express)*

**Phase 1: Intake.** Speichert die Datei, legt einen Case an. Kein Schema, keine Extraktion.

**Request:** `multipart/form-data`

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `file` | File | Ja | Die hochzuladende Datei (max. 50 MB) |
| `sessionId` | String | Nein | Session-ID zur Verknüpfung |

**Response:** `201 Created`
```json
{
  "documentId": "uuid-...",
  "caseId": "uuid-...",
  "status": "uploaded",
  "phase": "intake"
}
```

**Internes Verhalten:**

1. SHA-256 Hash des Datei-Buffers berechnen
2. `Cases` INSERT mit `status: 'open'`
3. `Documents` INSERT mit `phase: 'intake'`, `documentType: null`
4. `CaseEvents` INSERT: `document_uploaded`
5. Buffer in `global._pendingBuffers[docId]` zwischenspeichern (10 min TTL)

**Fehler:**

| Status | Grund |
|--------|-------|
| 400 | Keine Datei im Request |
| 500 | DB-Fehler |

---

### 3.2 `POST /api/documents/startExtraction` *(Express)*

**Phase 2: Schema-Extraktion.** Wird vom Agent aufgerufen, nachdem Dokumenttyp + Intent bestätigt sind.

**Request:**
```json
{
  "documentId": "uuid-...",
  "documentType": "fibu24"
}
```

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `documentId` | UUID | Ja | ID des Dokuments aus Phase 1 |
| `documentType` | String | Ja | Bestätigter Dokumenttyp |

**Response (Simulation):**
```json
{
  "documentId": "uuid-...",
  "jobId": "sim-uuid-...",
  "status": "done",
  "schemaName": "Fibu24_Schema",
  "validation": {
    "documentType": "fibu24",
    "isValid": true,
    "issues": [],
    "validChecks": ["Vorname vorhanden", "Nachname vorhanden", ...],
    "fieldCount": 4
  }
}
```

**Response (vw-doc-ai):**
```json
{
  "documentId": "uuid-...",
  "jobId": "real-vw-doc-ai-job-id",
  "status": "pending",
  "schemaName": "Fibu24_Schema"
}
```

**Internes Verhalten:**

1. `resolveUploadConfig(documentType)` → Schema-Infos auflösen
2. `Documents` UPDATE: `documentType`, `schemaId`, `phase: 'schema_bound'`
3. `CaseEvents` INSERT: `schema_bound`
4. **Falls vw-doc-ai konfiguriert + Buffer vorhanden:**
   - Upload an vw-doc-ai
   - `CaseEvents` INSERT: `extraction_started`
   - Returniere `status: 'pending'`
5. **Sonst (Simulation):**
   - `getSimulatedExtraction(documentType)` → simulierte Felder
   - `ExtractedFields` INSERT für jedes Feld
   - `CaseEvents` INSERT: `extraction_completed`
   - `runCrossValidation()` → Returniere `status: 'done'` mit Validation

**Fehler:**

| Status | Grund |
|--------|-------|
| 400 | `documentId` oder `documentType` fehlt |
| 404 | Dokument nicht gefunden |
| 500 | DB-Fehler |

---

### 3.3 `POST /api/documents/uploadAndExtract` *(CDS Action)*

**Metadaten-basierter Upload ohne File-Buffer.** Nur für programmatische Aufrufe, nicht vom Frontend genutzt.

**Request:**
```json
{
  "fileName": "ticket.pdf",
  "mimeType": "application/pdf",
  "documentType": "fibu24",
  "schemaId": "uuid-..."
}
```

**Response:**
```json
{
  "documentId": "uuid-...",
  "jobId": "sim-uuid-...",
  "status": "done",
  "validation": { ... }
}
```

**Hinweis:** Erstellt immer eine Simulation (kein File-Buffer verfügbar).

---

### 3.4 `POST /api/documents/pollJobStatus` *(CDS Action)*

Prüft den Extraktionsstatus eines Dokuments.

**Request:**
```json
{
  "documentId": "uuid-..."
}
```

**Response (done):**
```json
{
  "status": "done",
  "extractedData": [
    {
      "fieldName": "Vorname",
      "fieldValue": "Andrea",
      "confidence": 0.95,
      "rawValue": "Andrea",
      "page": 1
    }
  ],
  "validation": {
    "documentType": "fibu24",
    "isValid": true,
    "issues": [],
    "validChecks": ["Vorname vorhanden", ...],
    "fieldCount": 4,
    "businessChecks": ["Datum-Reihenfolge korrekt", ...]
  }
}
```

**Response (pending/processing):**
```json
{
  "status": "pending",
  "extractedData": []
}
```

**Internes Verhalten:**

1. Dokument aus DB laden
2. **Falls vw-doc-ai konfiguriert + Job nicht simuliert + nicht abgeschlossen:**
   - `vwDocAi.getJobStatus(doc.jobId)` aufrufen
   - Bei `DONE`: Felder in `ExtractedFields` speichern, Cross-Validation laufen
   - Bei `FAILED`: Status aktualisieren
   - Sonst: Status-Mapping zurückgeben
3. **Sonst:** Felder aus DB laden, Validation berechnen wenn `status === 'done'`

**Fehler:**

| Status | Grund |
|--------|-------|
| 404 | Dokument nicht gefunden |

---

### 3.5 `POST /api/documents/startSchemaExtraction` *(CDS Action)*

Schema-gebundene Extraktion starten (alternative API zur Express-Route).

**Request:**
```json
{
  "documentId": "uuid-...",
  "documentType": "fibu24"
}
```

**Response:** Identisch mit `startExtraction` Express-Route.

---

## 4. HCMService (`/api/hcm`)

### 4.1 `POST /api/hcm/getEmployeeData`

Mitarbeiterdaten anhand der Personalnummer abrufen.

**Request:**
```json
{
  "personnelNumber": "04237442"
}
```

**Response (gefunden):**
```json
{
  "employee": {
    "personnelNumber": "04237442",
    "firstName": "Andrea",
    "lastName": "Kirchhoff",
    "department": "Marketing",
    "position": "Marketing Manager",
    "weeklyHours": 40.00,
    "email": "andrea.kirchhoff@noventis.de",
    "costCenter": "5200",
    "entryDate": "2019-04-01"
  }
}
```

**Response (nicht gefunden → Fallback):**
```json
{
  "employee": {
    "personnelNumber": "00012345",
    "firstName": "Max",
    "lastName": "Mustermann",
    "department": "IT Services",
    "position": "Senior Entwickler",
    "weeklyHours": 40.00
  }
}
```

**Hinweis:** Bei nicht gefundener PNR wird ein **simulierter Fallback-Mitarbeiter** (Max Mustermann) zurückgegeben. Der Agent-Tool `hcm_get_employee` hat eine erweiterte Suche (Name, PNR) und kennt auch den nicht-gefunden-Fall – die CDS-Action selbst gibt immer einen Mitarbeiter zurück.

---

### 4.2 `POST /api/hcm/validateAction`

HR-Aktion validieren (ohne Einreichung).

**Request:**
```json
{
  "actionType": "elternzeit",
  "payload": "{\"beginn\":\"2025-03-01\",\"ende\":\"2026-02-28\"}"
}
```

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `actionType` | String | Ja | Typ der HR-Aktion (siehe Enum in DATA_MODEL.md) |
| `payload` | String (JSON) | Ja | Aktionsparameter als JSON-String |

**Response (valid):**
```json
{
  "valid": true,
  "messages": ["Validierung erfolgreich – Elternzeit-Antrag kann eingereicht werden"]
}
```

**Response (invalid):**
```json
{
  "valid": false,
  "messages": ["Beginn der Elternzeit fehlt", "Ende der Elternzeit fehlt"]
}
```

**Validierungsregeln nach actionType:**

| ActionType | Validierung |
|-----------|-------------|
| `elternzeit` | `beginn` + `ende` pflicht, `beginn < ende` |
| `teilzeit` | `wochenstunden` (5–39) + `beginn` pflicht |
| `vollzeit_rueckkehr` | `beginn` pflicht |
| *(andere)* | Keine spezifische Validierung |

---

### 4.3 `POST /api/hcm/submitAction`

HR-Aktion einreichen (simuliert).

**Request:**
```json
{
  "actionType": "fibu24_erstattung",
  "employeeId": "uuid-...",
  "payload": "{\"Vorname\":\"Andrea\",\"Nachname\":\"Kirchhoff\"}"
}
```

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `actionType` | String | Ja | Typ der HR-Aktion |
| `employeeId` | UUID | Ja | Employee-UUID (nicht PNR!) |
| `payload` | String (JSON) | Ja | Aktionsparameter |

**Response:**
```json
{
  "actionId": "uuid-...",
  "status": "simuliert",
  "message": "HR-Aktion 'fibu24_erstattung' erfolgreich simuliert. In Produktion wird diese Aktion im SAP HCM System verarbeitet."
}
```

**Internes Verhalten:**

1. `validateAction` intern aufrufen
2. Bei Validierungsfehler → `400` mit Fehlermeldungen
3. `HCMActions` INSERT mit `status: 'simuliert'`
4. Result enthält Timestamp + Validierungsmeldungen

**Fehler:**

| Status | Grund |
|--------|-------|
| 400 | Validierung fehlgeschlagen |

---

## 5. OData-Entitäten (Read-Only)

Alle CDS-Services exponieren ihre Entities auch als standard OData-Endpunkte:

| Endpunkt | Entity | Zugriff |
|----------|--------|---------|
| `GET /api/chat/Sessions` | ChatSessions | Lesend |
| `GET /api/chat/Messages` | ChatMessages | Lesend |
| `GET /api/documents/Documents` | Documents | Lesend |
| `GET /api/documents/ExtractedFields` | ExtractedFields | Lesend |
| `GET /api/documents/Cases` | Cases | Lesend |
| `GET /api/documents/CaseEvents` | CaseEvents | Lesend |
| `GET /api/hcm/Employees` | Employees | Lesend (`@readonly`) |
| `GET /api/hcm/Actions` | HCMActions | Lesend |

OData-Features: `$filter`, `$select`, `$expand`, `$orderby`, `$top`, `$skip`.

---

## 6. Fehlerbehandlung

### 6.1 HTTP-Status-Codes

| Code | Bedeutung | Verwendung |
|------|-----------|-----------|
| 200 | OK | Erfolgreiche Actions |
| 201 | Created | Datei-Upload erfolgreich |
| 400 | Bad Request | Fehlende Parameter, Validierungsfehler |
| 404 | Not Found | Entity nicht gefunden |
| 500 | Internal Server Error | Unerwarteter Fehler |

### 6.2 Fehler-Response-Format

```json
{
  "error": "Beschreibung des Fehlers"
}
```

Bei CDS-Actions wird das Standard-CAP-Fehlerformat verwendet:
```json
{
  "error": {
    "code": "400",
    "message": "Validierungsfehler: Beginn fehlt; Ende fehlt"
  }
}
```

---

## 7. Sequenzdiagramm: Vollständiger Dokumenten-Upload

```
Browser          Vite-Proxy       Express(server.js)    CDS-Services       Agent-Loop
  │                  │                    │                   │                  │
  │ POST upload      │                    │                   │                  │
  │ (FormData) ──────┼───────────────────→│                   │                  │
  │                  │                    │ INSERT Case       │                  │
  │                  │                    │ INSERT Document   │                  │
  │                  │                    │ INSERT CaseEvent  │                  │
  │ 201 {docId,      │                    │                   │                  │
  │   caseId}  ←─────┼────────────────────│                   │                  │
  │                  │                    │                   │                  │
  │ POST sendMessage │                    │                   │                  │
  │ „Doc hochgeladen"┼───────────────────────────────────────→│                  │
  │                  │                    │                   │ runAgentLoop()──→│
  │                  │                    │                   │                  │
  │                  │                    │                   │  docai_analyze   │
  │                  │                    │                   │←─────────────────│
  │                  │                    │                   │                  │
  │                  │                    │                   │  → Workflow      │
  │                  │                    │                   │    intake state  │
  │                  │                    │                   │                  │
  │ {reply, suggest, │                    │                   │                  │
  │  toolCalls}←─────┼───────────────────────────────────────←│                  │
  │                  │                    │                   │                  │
  │ User bestätigt   │                    │                   │                  │
  │ POST sendMessage ┼───────────────────────────────────────→│                  │
  │                  │                    │                   │ runAgentLoop()──→│
  │                  │                    │                   │                  │
  │                  │  POST startExtraction                  │  docai_start_   │
  │                  │  ←─────────────────┼───────────────────┼──extraction     │
  │                  │                    │ Schema binden     │                  │
  │                  │                    │ Extraktion/Sim    │                  │
  │                  │  ─────────────────→│                   │                  │
  │                  │                    │                   │  docai_get_      │
  │                  │                    │                   │  extraction      │
  │                  │                    │                   │                  │
  │                  │                    │                   │  hcm_get_employee│
  │                  │                    │                   │                  │
  │ {reply, data}    │                    │                   │                  │
  │ ←────────────────┼───────────────────────────────────────←│                  │
```

---

## 8. Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|----------|---------|-------------|
| `OPENAI_API_KEY` | Ja* | OpenAI API-Key (*ohne → Fallback-Modus) |
| `OPENAI_MODEL` | Nein | LLM-Modell (Default: `gpt-4o-mini`) |
| `VW_DOCAI_URL` | Nein | vw-doc-ai API-URL |
| `VW_DOCAI_XSUAA_URL` | Nein | XSUAA Token-URL |
| `VW_DOCAI_CLIENT_ID` | Nein | OAuth2 Client-ID |
| `VW_DOCAI_CLIENT_SECRET` | Nein | OAuth2 Client-Secret |
| `VW_DOCAI_CLIENT_APP_ID` | Nein | App-ID (Default: `hr-agent`) |
