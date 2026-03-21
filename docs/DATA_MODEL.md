# Datenmodell – CDS Schema & Seed-Daten

> **Datei:** `db/schema.cds`  
> **Namespace:** `hr.agent`  
> **Datenbank:** SQLite (`db.sqlite`)  
> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [API_REFERENCE.md](API_REFERENCE.md)

---

## 1. Übersicht

Das Datenmodell besteht aus **8 CDS-Entities** in 4 funktionalen Gruppen:

```
┌──────────────────────────────────────────────────────────────┐
│                       Chat-Schicht                           │
│  ChatSessions ──(1:N)──→ ChatMessages                       │
└──────────────────────────┬───────────────────────────────────┘
                           │ (1:N)
┌──────────────────────────┴───────────────────────────────────┐
│                       Case-Schicht                           │
│  Cases ──(1:N)──→ CaseEvents                                │
│       ──(1:N)──→ Documents ──(1:N)──→ ExtractedFields       │
│       ──(1:N)──→ HCMActions                                 │
└──────────────────────────────────────────────────────────────┘
                                           │
┌──────────────────────────────────────────┴───────────────────┐
│                     Stammdaten                               │
│  Employees                                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Entity-Referenz

### 2.1 `ChatSessions`

**Zweck:** Eine Chat-Sitzung des Users. Bündelt alle Nachrichten.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel |
| `createdAt` | `Timestamp` | `managed` | Erstellungszeitpunkt |
| `modifiedAt` | `Timestamp` | `managed` | Letzter Zugriff |
| `createdBy` | `String` | `managed` | Ersteller |
| `modifiedBy` | `String` | `managed` | Letzter Bearbeiter |
| `title` | `String(200)` | – | Titel (erste 80 Zeichen der ersten Nachricht) |
| `messages` | `Composition` | – | → `ChatMessages` (1:N) |

**Erzeugung:** `chat-service.js` → `sendMessage` Handler, wenn kein `sessionId` übergeben wird oder Session nicht existiert.

---

### 2.2 `ChatMessages`

**Zweck:** Einzelne Chat-Nachricht (User, Assistant oder System).

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel |
| `createdAt` | `Timestamp` | `managed` | Nachricht-Zeitstempel |
| `session` | `Association` | – | → `ChatSessions` |
| `role` | `String (enum)` | – | `user`, `assistant`, `system` |
| `content` | `LargeString` | – | Nachricht-Inhalt (inkl. `[TOOL_CONTEXT:...]` bei Assistant) |

**Inhalt von `content` bei Assistant-Nachrichten:**
```
Antwort-Text an den User

[TOOL_CONTEXT:[{"tool":"kb_search","args":{"query":"..."},"result":{...}}]]
```

Der `[TOOL_CONTEXT:...]` Block wird von `expandHistoryWithToolContext()` vor dem LLM-Aufruf entfernt.

---

### 2.3 `Cases`

**Zweck:** Zentrales Objekt für einen HR-Vorgang. Bündelt Workflow-State, Dokumente, Events und HCM-Aktionen.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel (= caseId) |
| `createdAt` | `Timestamp` | `managed` | Erstellungszeitpunkt |
| `modifiedAt` | `Timestamp` | `managed` | Letzte State-Änderung |
| `session` | `Association` | – | → `ChatSessions` |
| `status` | `String (enum)` | – | Fachlicher Status |
| `productId` | `String(50)` | – | Personalprodukt-ID (z.B. `'fibu24'`) |
| `workflowState` | `String(50)` | – | State-Machine-Zustand |
| `workflowData` | `LargeString` | – | JSON: Akkumulierte Workflow-Daten |
| `documentType` | `String(100)` | – | Bestätigter Dokumenttyp |
| `intent` | `String(100)` | – | Bestätigter Nutzer-Intent |
| `docTypeConfidence` | `Decimal(3,2)` | – | Typ-Hypothese Sicherheit (0.00–1.00) |
| `intentConfidence` | `Decimal(3,2)` | – | Intent-Hypothese Sicherheit (0.00–1.00) |
| `documents` | `Composition` | – | → `Documents` (1:N) |
| `events` | `Composition` | – | → `CaseEvents` (1:N) |
| `hcmActions` | `Composition` | – | → `HCMActions` (1:N) |

**`status` Enum-Werte:**

| Wert | Beschreibung |
|------|-------------|
| `open` | Neu angelegt (nach Upload) |
| `awaiting_input` | Agent braucht User-Input (Typ/Intent unklar) |
| `processing` | Verarbeitung läuft (Extraktion, Validierung) |
| `validated` | Validierung durchlaufen |
| `completed` | Abgeschlossen |
| `failed` | Fehlgeschlagen |

**`workflowState` Werte:** `intake`, `awaiting_confirmation`, `awaiting_fields`, `awaiting_employee`, `awaiting_correction`, `awaiting_approval`, `done`, `cancelled`

**`workflowData` Struktur (JSON):**
```json
{
  "_documentId": "uuid-...",
  "analysis": { "bestDocType": {...}, "bestIntent": {...}, ... },
  "extraction": { "extractedFields": [...], "crossValidation": {...} },
  "employee": { "personnelNumber": "...", "firstName": "...", ... },
  "validationResult": { "issues": [], "valid": [] }
}
```

---

### 2.4 `CaseEvents`

**Zweck:** Audit Trail – protokolliert jede fachlich relevante Aktion.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel |
| `createdAt` | `Timestamp` | `managed` | Event-Zeitpunkt |
| `caseRef` | `Association` | – | → `Cases` |
| `eventType` | `String (enum)` | – | Event-Kategorie |
| `payload` | `LargeString` | – | JSON mit Event-Details |

**`eventType` Enum-Werte:**

| Event | Auslöser | Payload enthält |
|-------|----------|-----------------|
| `document_uploaded` | `server.js` Upload | documentId, fileName, mimeType, fileHash, fileSize |
| `ai_analysis` | `docai_analyze_document` | Vollständige Analyse (bestDocType, bestIntent, ...) |
| `user_confirmed_type` | (noch nicht implementiert) | – |
| `user_confirmed_intent` | (noch nicht implementiert) | – |
| `schema_bound` | `docai_start_extraction` | documentId, documentType, schemaId, schemaName |
| `extraction_started` | `docai_start_extraction` (vw-doc-ai) | documentId, jobId, schemaName |
| `extraction_completed` | `docai_start_extraction` (Simulation) | documentId, jobId, fieldCount, simulated |
| `extraction_failed` | (bei Fehler) | – |
| `cross_validation` | (noch nicht explizit) | – |
| `business_validation` | (noch nicht explizit) | – |
| `user_approved` | (noch nicht explizit) | – |
| `hcm_action_submitted` | (noch nicht explizit) | – |
| `hcm_action_completed` | (noch nicht explizit) | – |

---

### 2.5 `Documents`

**Zweck:** Repräsentiert ein hochgeladenes Dokument mit Verarbeitungsstatus.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel (= documentId) |
| `createdAt` | `Timestamp` | `managed` | Upload-Zeitpunkt |
| `caseRef` | `Association` | – | → `Cases` |
| `fileName` | `String(500)` | – | Originaler Dateiname |
| `mimeType` | `String(100)` | – | MIME-Typ (application/pdf, image/png, ...) |
| `fileHash` | `String(64)` | – | SHA-256 Hash (Deduplizierung) |
| `status` | `String (enum)` | – | Verarbeitungsstatus der Extraktion |
| `phase` | `String (enum)` | – | Fachliche Verarbeitungsphase |
| `documentType` | `String(100)` | – | Bestätigter Dokumenttyp (null bei Intake) |
| `jobId` | `String(36)` | – | vw-doc-ai Job-ID oder 'sim-...' |
| `schemaId` | `String(36)` | – | vw-doc-ai Schema-UUID |
| `aiAnalysis` | `LargeString` | – | JSON: Ergebnis von docai_analyze_document |
| `extractedData` | `Composition` | – | → `ExtractedFields` (1:N) |

**`status` Enum-Werte:**

| Wert | Beschreibung |
|------|-------------|
| `uploaded` | Hochgeladen, noch nicht verarbeitet |
| `pending` | Extraktion gestartet, wartet auf Ergebnis |
| `processing` | Extraktion läuft |
| `done` | Extraktion abgeschlossen |
| `failed` | Extraktion fehlgeschlagen |

**`phase` Enum-Werte (fachliche Pipeline):**

| Phase | Beschreibung | Gesetzt durch |
|-------|-------------|--------------|
| `intake` | Nur hochgeladen | `server.js` Upload |
| `analyzed` | LLM-Analyse abgeschlossen | `docai_analyze_document` |
| `schema_bound` | Schema zugewiesen | `docai_start_extraction` |
| `extracted` | Extraktion abgeschlossen | `docai_start_extraction` / `docai_get_extraction` |
| `validated` | Cross-/Business-Validation durchlaufen | (noch nicht explizit) |

---

### 2.6 `ExtractedFields`

**Zweck:** Einzelne extrahierte Felder eines Dokuments mit Confidence-Scores.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel |
| `document` | `Association` | – | → `Documents` |
| `fieldName` | `String(200)` | – | Feldname (z.B. "Vorname", "Gültig ab Datum") |
| `fieldValue` | `LargeString` | – | Extrahierter Wert |
| `confidence` | `Decimal(5,4)` | – | Confidence-Score (0.0000–1.0000) |
| `rawValue` | `LargeString` | – | Roher OCR-Wert (vor Normalisierung) |
| `page` | `Integer` | – | Seite im Dokument |

**Hinweis:** Kein `managed` Aspect – keine createdAt/modifiedAt Felder.

---

### 2.7 `Employees`

**Zweck:** Simulierte SAP HCM Mitarbeiterstammdaten.

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel |
| `personnelNumber` | `String(8)` | – | SAP Personalnummer |
| `firstName` | `String(100)` | – | Vorname |
| `lastName` | `String(100)` | – | Nachname |
| `email` | `String(200)` | – | E-Mail-Adresse |
| `department` | `String(200)` | – | Abteilung |
| `position` | `String(200)` | – | Stellenbezeichnung |
| `entryDate` | `Date` | – | Eintrittsdatum |
| `weeklyHours` | `Decimal(5,2)` | – | Wochenarbeitszeit |
| `costCenter` | `String(20)` | – | Kostenstelle |

**Hinweis:** Kein `managed` Aspect – keine automatischen Zeitstempel.

---

### 2.8 `HCMActions`

**Zweck:** Eingereichte HR-Aktionen (simuliert).

| Feld | Typ | Herkunft | Beschreibung |
|------|-----|----------|-------------|
| `ID` | `UUID` | `cuid` | Primärschlüssel (= actionId) |
| `createdAt` | `Timestamp` | `managed` | Einreichungszeitpunkt |
| `caseRef` | `Association` | – | → `Cases` |
| `employee` | `Association` | – | → `Employees` |
| `actionType` | `String (enum)` | – | Typ der HR-Aktion |
| `status` | `String (enum)` | – | Bearbeitungsstatus |
| `payload` | `LargeString` | – | JSON: Aktionsparameter |
| `result` | `LargeString` | – | JSON: Ergebnis |

**`actionType` Enum-Werte:**
```
elternzeit, teilzeit, vollzeit_rueckkehr, altersteilzeit, sabbatical,
adressaenderung, gehaltsanpassung, fibu24_erstattung, krankmeldung,
reisekostenerstattung
```

**`status` Enum-Werte:**

| Wert | Beschreibung |
|------|-------------|
| `entwurf` | Noch nicht eingereicht |
| `eingereicht` | Beim HR-Team eingereicht |
| `genehmigt` | Von HR genehmigt |
| `abgelehnt` | Von HR abgelehnt |
| `simuliert` | Im Prototyp simuliert eingereicht |

---

## 3. Seed-Daten

### 3.1 Mitarbeiter (`db/data/hr.agent-Employees.json`)

| # | PNR | Name | Abteilung | Position | Kostenstelle |
|---|-----|------|-----------|----------|-------------|
| 1 | 00012345 | Max Mustermann | IT Services | Senior Entwickler | 4711 |
| 2 | 00012346 | Anna Schmidt | Human Resources | HR Business Partner | 1200 |
| 3 | 00012347 | Thomas Weber | Finanzen | Controller | 3100 |
| 4 | **04237442** | **Andrea Kirchhoff** | **Marketing** | **Marketing Manager** | **5200** |
| 5 | 00056789 | Sarah Meier | Vertrieb | Account Manager | 2100 |
| 6 | 00034567 | Markus Braun | Produktion | Schichtleiter | 6100 |
| 7 | 00078901 | Julia Fischer | Recht & Compliance | Syndikusanwältin | 7100 |

**Andrea Kirchhoff** (PNR 04237442) ist die Demo-Mitarbeiterin für Fibu24-Tests – ihre Daten matchen die `simulatedExtraction` von `fibu24.js`.

### 3.2 E-Mail-Domain

Alle Mitarbeiter nutzen `@noventis.de` als E-Mail-Domain.

---

## 4. Entity-Beziehungen (ER-Diagramm)

```
ChatSessions (1) ──────── (N) ChatMessages
     │
     │ (1:N)
     ▼
  Cases (1) ──────── (N) CaseEvents
     │  │
     │  │ (1:N)
     │  ▼
     │ Documents (1) ──── (N) ExtractedFields
     │
     │ (1:N)
     ▼
  HCMActions (N) ──── (1) Employees
```

**Cascade-Verhalten:** Compositions (→) implizieren Lifecycle-Management. Ein Case "besitzt" seine Documents, Events und Actions.

---

## 5. Datenbank-Schema (SQLite)

### 5.1 Deploy-Befehl

```bash
npm run db:deploy    # = cds deploy --to sqlite:db.sqlite
```

### 5.2 Generierte Tabellen

CDS generiert automatisch SQLite-Tabellen mit dem Namespace als Prefix:

```sql
hr_agent_ChatSessions
hr_agent_ChatMessages
hr_agent_Cases
hr_agent_CaseEvents
hr_agent_Documents
hr_agent_ExtractedFields
hr_agent_Employees
hr_agent_HCMActions
```

### 5.3 CDS-Aspekte

- `cuid` → generiert `ID` als UUID-Primärschlüssel
- `managed` → generiert `createdAt`, `modifiedAt`, `createdBy`, `modifiedBy`
