# Tools-Referenz – Alle Agent-Tools

> **Datei:** `srv/lib/agent-tools.js` (~1050 Zeilen)  
> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [WORKFLOW_ENGINE.md](WORKFLOW_ENGINE.md)

---

## 1. Übersicht

Der Agent verfügt über **11 Tools** (plus 3 Infrastruktur-Funktionen), aufgeteilt in vier Kategorien:

| Kategorie | Tools | Nutzung |
|-----------|-------|---------|
| **Knowledge Base** | `kb_search`, `kb_list_topics` | LLM-Modus (freie Konversation) |
| **HCM** | `hcm_get_employee`, `hcm_validate_action`, `hcm_submit_action` | Workflow + LLM-Modus |
| **Document AI** | `docai_analyze_document`, `docai_start_extraction`, `docai_get_extraction` | Nur Workflow-Modus |
| **Service-Info** | `docai_check_status`, `docai_list_document_types`, `docai_list_schemas`, `docai_list_extractions`, `docai_review` | LLM-Modus + Workflow |

### 1.1 Tool-Verfügbarkeit nach Modus

Im **LLM-Modus** (keine aktiver Workflow) erhält das LLM nur eine gefilterte Teilmenge:

```
LLM-Modus:  kb_search, kb_list_topics, hcm_get_employee,
            docai_list_document_types, docai_check_status

Workflow:   Alle Tools (via executeTool() direkt aufgerufen, nicht vom LLM)
```

Die Filterung findet in `agent-loop.js` statt:
```javascript
const llmTools = allToolDefinitions.filter(td =>
  ['kb_search', 'kb_list_topics', 'hcm_get_employee',
   'docai_list_document_types', 'docai_check_status'].includes(td.function.name)
);
```

### 1.2 Infrastruktur-Funktionen

| Funktion | Signatur | Beschreibung |
|----------|----------|--------------|
| `createTools(db, openaiClient)` | `(Object, OpenAI) → tools` | Erstellt Tool-Registry mit DB-Zugriff |
| `getToolDefinitions(tools)` | `(tools) → OpenAI-Schema[]` | Gibt Function-Calling-Schemas zurück |
| `executeTool(tools, name, args)` | `(tools, string, Object) → Result` | Dispatcher für Tool-Ausführung |

---

## 2. Knowledge-Base-Tools

### 2.1 `kb_search` – Wissensbasis durchsuchen

**Beschreibung:** Durchsucht die lokale HR-Wissensbasis (11 Chunks) nach relevanten Informationen.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `query` | `string` | ✅ | Suchanfrage zum HR-Thema |

**Rückgabe:**
```json
// Treffer
{
  "found": true,
  "results": [
    { "topic": "Elternzeit", "content": "## Elternzeit – Grundlagen\n..." }
  ]
}

// Kein Treffer
{
  "found": false,
  "message": "Keine relevanten Einträge in der Knowledge Base gefunden."
}
```

**Algorithmus:** Keyword-basiertes Scoring:
- Exakter Keyword-Match: +3 Punkte
- Wort-in-Keyword: +1 Punkt
- Topic-Match: +2 Punkte
- Top 3 nach Score sortiert

**Abgedeckte Themen:** Elternzeit (3 Chunks), Teilzeit (3), Vollzeit-Rückkehr, Altersteilzeit, Sabbatical, Mobile Arbeit, HR Self-Services, Dokumentenverarbeitung

---

### 2.2 `kb_list_topics` – Themen auflisten

**Beschreibung:** Listet alle verfügbaren Themen der HR-Wissensbasis.

**Parameter:** Keine

**Rückgabe:**
```json
{
  "topics": [
    "Elternzeit", "Teilzeit", "Vollzeit-Rückkehr", "Altersteilzeit",
    "Sabbatical / Langzeitkonto", "Mobile Arbeit", "HR Self-Services",
    "Dokumentenverarbeitung"
  ]
}
```

---

## 3. HCM-Tools

### 3.1 `hcm_get_employee` – Mitarbeiterdaten abrufen

**Beschreibung:** Sucht Mitarbeiter in der Employees-Tabelle (simuliertes SAP HCM).

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `personnelNumber` | `string` | – | 8-stellige Personalnummer (z.B. `"00012345"`) |
| `lastName` | `string` | – | Nachname für Suche |
| `firstName` | `string` | – | Vorname zur Eingrenzung (nur mit `lastName`) |

**Suchlogik (Priorität):**
1. `personnelNumber` → exakte Suche
2. `lastName` + `firstName` → Kombination
3. nur `lastName` → Nachname-Suche
4. Keiner → Fehlermeldung

**Rückgabe:**
```json
// Gefunden
{
  "found": true,
  "employee": {
    "personnelNumber": "04237442",
    "firstName": "Andrea",
    "lastName": "Kirchhoff",
    "email": "andrea.kirchhoff@noventis.de",
    "department": "Marketing",
    "position": "Marketing Manager",
    "entryDate": "2020-03-15",
    "weeklyHours": 40.00,
    "costCenter": "5200"
  }
}

// Nicht gefunden
{
  "found": false,
  "message": "Kein Mitarbeiter mit Personalnummer \"12345678\" gefunden."
}
```

**Wichtig:** Kein Fallback auf `lastName`-only wenn `firstName` angegeben aber kein Treffer. Dies verhindert falsche Zuordnungen (z.B. "Lucas Mustermann" → "Max Mustermann").

---

### 3.2 `hcm_validate_action` – HR-Aktion validieren

**Beschreibung:** Prüft eine geplante HR-Aktion gegen Geschäftsregeln.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `actionType` | `string (enum)` | ✅ | Typ der Aktion |
| `payload` | `string` | ✅ | JSON-String mit Aktionsdetails |

**actionType-Werte:**
```
elternzeit, teilzeit, vollzeit_rueckkehr, altersteilzeit, sabbatical,
adressaenderung, gehaltsanpassung, fibu24_erstattung, krankmeldung,
reisekostenerstattung
```

**Validierungsregeln nach Typ:**

| actionType | Pflichtfelder | Zusätzliche Prüfungen |
|------------|---------------|----------------------|
| `elternzeit` | `beginn`, `ende` | Beginn < Ende |
| `teilzeit` | `wochenstunden`, `beginn` | 5 ≤ Stunden ≤ 39, berechnet Urlaubsanspruch |
| `vollzeit_rueckkehr` | `beginn` | – |
| Sonstige | – | Generisch: "vorvalidiert" |

**Rückgabe:**
```json
{ "valid": true,  "messages": ["Validierung erfolgreich – ..."] }
{ "valid": false, "messages": ["Beginn muss vor dem Ende liegen"] }
```

---

### 3.3 `hcm_submit_action` – HR-Aktion einreichen

**Beschreibung:** Erstellt einen HCMActions-Datensatz mit Status `simuliert`.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `actionType` | `string (enum)` | ✅ | Typ der Aktion |
| `employeeId` | `string` | ✅ | UUID des Mitarbeiters |
| `payload` | `string` | ✅ | JSON-String mit Aktionsdetails |

**Rückgabe:**
```json
{
  "actionId": "uuid-...",
  "status": "simuliert",
  "message": "HR-Aktion 'fibu24_erstattung' erfolgreich simuliert eingereicht."
}
```

**DB-Operation:** `INSERT INTO HCMActions (ID, employee_ID, actionType, status, payload, result)`

**Wichtig:** Nur nach expliziter User-Bestätigung verwenden. In Produktion würde stattdessen ein SAP HCM API-Call erfolgen.

---

## 4. Document-AI-Tools

### 4.1 `docai_analyze_document` – KI-Dokumentanalyse (Phase 1)

**Beschreibung:** Analysiert ein hochgeladenes Dokument mittels LLM (GPT-4o Vision für Bilder, PDF-Text-Extraktion für PDFs). Liefert eine Typ-Hypothese.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `documentId` | `string` | ✅ | UUID des Dokuments |
| `userMessage` | `string` | – | Begleitnachricht des Users |

**Verarbeitungspipeline:**

```
1. Dokument aus DB laden
2. File-Buffer aus global._pendingBuffers holen
3. MIME-Typ prüfen:
   ├── PDF → pdf-parse Textextraktion (max 3000 Zeichen)
   │         Falls <20 Zeichen Text: PDF als File-Content an API
   ├── Image (PNG/JPG/TIFF) → Base64 für Vision API
   └── Sonstiges → Warnung
4. LLM-Klassifikation senden (immer, auch nur mit Dateiname)
   ├── Wenn LLM mit Content fehlschlägt (400) → Retry nur mit Dateiname
   └── JSON-Response parsen
5. Fallback: Dateiname-Heuristik (Trigger-Matching)
6. Confidence-basierte Entscheidung:
   ├── ≥0.7: Empfehlung zur direkten Verarbeitung
   ├── 0.5-0.7: Bestätigung empfohlen
   └── <0.5: User fragen
7. DB aktualisieren: Document.phase → 'analyzed', CaseEvent loggen
```

**Rückgabe:**
```json
{
  "analysis": {
    "documentId": "uuid-...",
    "fileName": "fibu24_ticket.pdf",
    "bestDocType": {
      "documentType": "Fibu24-Nachweis",
      "label": "Fibu24-Nachweis (Fahrkarten-Erstattung)",
      "confidence": 0.85,
      "evidence": "KI-Analyse (pdf-text): Fahrkarte erkannt"
    },
    "bestIntent": {
      "intent": "antrag_einreichen",
      "confidence": 0.6,
      "evidence": "Aus Dokumentinhalt abgeleitet"
    },
    "summary": "ÖPNV-Monatsabo für Andrea Kirchhoff",
    "detectedFields": ["Vorname", "Nachname", "Gültig ab"],
    "needsUserInput": [],
    "source": "llm-pdf-text",
    "contentSource": "pdf-text"
  },
  "recommendation": "Dokumenttyp \"Fibu24-Nachweis\" erkannt (85%)."
}
```

---

### 4.2 `docai_start_extraction` – Extraktion starten (Phase 2)

**Beschreibung:** Bindet das vw-doc-ai Schema und startet die strukturierte Extraktion.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `documentId` | `string` | ✅ | UUID des Dokuments |
| `documentType` | `string` | ✅ | Bestätigter Dokumenttyp |

**Ablauf:**

```
1. Prüfen ob bereits extrahiert → früh returnen
2. resolveUploadConfig(documentType) → Schema-Details
3. Schema binden: Document.documentType + schemaId + phase='schema_bound'
4. CaseEvent: 'schema_bound' loggen
5. vw-doc-ai konfiguriert UND Buffer vorhanden?
   ├── Ja: vwDocAi.uploadDocument(buffer, fileName, mime, opts)
   │       → Buffer freigeben, Return jobId
   └── Nein: Simulation
       → getSimulatedExtraction(documentType)
       → Felder in ExtractedFields schreiben
       → Return simJobId (Prefix: 'sim-')
```

**Rückgabe:**
```json
{
  "success": true,
  "documentId": "uuid-...",
  "documentType": "Fibu24-Nachweis",
  "jobId": "sim-uuid-...",
  "status": "done",
  "schemaName": "Fibu24_Schema",
  "validation": { "isValid": true, "issues": [], ... },
  "message": "Extraktion abgeschlossen (simuliert)."
}
```

---

### 4.3 `docai_get_extraction` – Extraktionsergebnis abrufen

**Beschreibung:** Holt extrahierte Felder und führt Cross-Validation durch.

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `documentId` | `string` | ✅ | UUID des Dokuments |

**Ablauf:**

```
1. Dokument aus DB laden
2. Echte vw-doc-ai Job-ID (kein 'sim-' Prefix)?
   ├── Ja: Polling mit 4 Versuchen [0ms, 4s, 5s, 6s]
   │       → DONE: Felder in lokale DB speichern
   │       → FAILED: Fehlermeldung
   │       → PROCESSING: "Bitte erneut versuchen"
   └── Nein: Lokale ExtractedFields aus DB laden
3. runCrossValidation(documentType, fields)
4. workflowContext anhängen (employeeField, hcmAction, businessChecks)
```

**Rückgabe:**
```json
{
  "found": true,
  "source": "simulation",
  "status": "done",
  "documentType": "Fibu24-Nachweis",
  "document": { "id": "...", "fileName": "...", "status": "done" },
  "extractedFields": [
    { "fieldName": "Vorname", "fieldValue": "Andrea", "confidence": 0.94, "rawValue": "Andrea", "page": 1 }
  ],
  "crossValidation": {
    "documentType": "Fibu24-Nachweis",
    "schemaFound": true,
    "isValid": true,
    "issues": [],
    "validChecks": ["Gültigkeitszeitraum: 365 Tage", "Inhaber: Andrea Kirchhoff"],
    "fieldCount": 4,
    "businessChecks": ["Name stimmt überein", ...],
    "employeeField": "Nachname",
    "hcmAction": "fibu24_erstattung"
  },
  "workflowContext": {
    "employeeField": "Nachname",
    "hcmAction": "fibu24_erstattung",
    "businessChecks": [...]
  }
}
```

---

## 5. Service-Info-Tools

### 5.1 `docai_check_status` – Service-Health

**Parameter:** Keine

**Rückgabe:**
```json
// Konfiguriert + erreichbar
{ "available": true, "configured": true, ... }

// Konfiguriert aber nicht erreichbar
{ "available": false, "configured": true, "error": "Connection refused" }

// Nicht konfiguriert
{ "available": false, "configured": false, "message": "Simulationsmodus aktiv." }
```

---

### 5.2 `docai_list_document_types` – Verfügbare Dokumenttypen

**Parameter:** Keine

**Rückgabe:**
```json
{
  "documentTypes": [
    {
      "documentType": "Fibu24-Nachweis",
      "label": "Fibu24-Nachweis (Fahrkarten-Erstattung)",
      "schemaId": "60ae4d9b-...",
      "vwDocAiSchemaName": "Fibu24_Schema",
      "configured": true,
      "employeeField": "Nachname",
      "hcmAction": "fibu24_erstattung",
      "triggers": ["fibu24", "fahrkarte", ...],
      "businessChecks": [...]
    }
  ],
  "hint": "Bei Upload wird der Dokumenttyp automatisch erkannt..."
}
```

---

### 5.3 `docai_list_schemas` – vw-doc-ai Schemas

**Parameter:** Keine

**Rückgabe:**
```json
// Konfiguriert
{ "configured": true, "schemas": [...] }

// Nicht konfiguriert
{ "configured": false, "message": "Simulationsmodus aktiv." }
```

---

### 5.4 `docai_list_extractions` – Letzte Extraktionen

**Parameter:** Keine

**Rückgabe:**
```json
{
  "documents": [
    {
      "documentId": "uuid-...",
      "fileName": "fibu24_ticket.pdf",
      "documentType": "Fibu24-Nachweis",
      "status": "done",
      "createdAt": "2026-03-17T14:30:00Z"
    }
  ]
}
```

Limitiert auf die letzten 10 Dokumente, sortiert nach `createdAt desc`.

---

### 5.5 `docai_review` – Human-in-the-Loop Review

**Parameter:**

| Parameter | Typ | Required | Beschreibung |
|-----------|-----|----------|--------------|
| `documentId` | `string` | ✅ | UUID des Dokuments |
| `action` | `string (enum)` | ✅ | `approve` oder `reject` |
| `comment` | `string` | – | Optionaler Kommentar |

**Ablauf:**

```
1. Dokument laden
2. vw-doc-ai konfiguriert UND jobId vorhanden?
   ├── Ja: vwDocAi.approveJob()/rejectJob()
   └── Nein: Lokalen Status auf 'approved'/'rejected' setzen
3. Document.status aktualisieren
```

**Rückgabe:**
```json
{ "success": true, "action": "approve", "status": "approved" }
```

---

## 6. Tool-Aufruf-Konventionen

### 6.1 Im Workflow-Modus

Tools werden direkt von der Workflow-Engine aufgerufen, nicht vom LLM:

```javascript
const result = await executeTool(ctx.tools, 'docai_analyze_document', {
  documentId: ctx.documentId,
  userMessage: ctx.userMessage,
});
toolCalls.push({ tool: 'docai_analyze_document', args: {...}, result });
```

### 6.2 Im LLM-Modus

Das LLM entscheidet über Tool-Aufrufe via Function-Calling:

```javascript
const completion = await openai.chat.completions.create({
  model,
  messages,
  tools: llmTools,        // Gefiltertes Tool-Set
  tool_choice: 'auto',    // LLM entscheidet
});
```

### 6.3 Fehlerbehandlung

Alle Tool-Aufrufe sind in `executeTool()` gekapselt mit try/catch:

```javascript
async function executeTool(tools, toolName, args) {
  const tool = tools[toolName];
  if (!tool) return { error: `Unbekanntes Tool: ${toolName}` };
  try {
    return await tool.execute(args);
  } catch (err) {
    return { error: `Tool-Fehler (${toolName}): ${err.message}` };
  }
}
```

Fehler werden als `{ error: "..." }` zurückgegeben, nie als Exception.
