# HR-Agent – Systemarchitektur

> **Version:** 1.0  
> **Stand:** März 2026  
> **Stack:** CAP Node.js · SQLite · OpenAI · React + Vite  
> **Kontext:** HR-Agent Prototyp bei NOVENTIS (Volkswagen-Konzern)

---

## 1. Systemübersicht

Der HR-Agent ist ein KI-gestütztes Beratungssystem für Personalprozesse. Mitarbeiter können HR-Fragen stellen und Dokumente hochladen, die automatisch verarbeitet und in SAP HCM-Aktionen überführt werden.

### 1.1 High-Level-Architektur

```
┌───────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                       │
│                    Port 5173 (Dev)                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │
│  │  Navbar   │  │  Topbar  │  │ChatWindow│  │ FloatingTags  │   │
│  └──────────┘  └──────────┘  └────┬─────┘  └───────────────┘   │
│                                    │                             │
│                              api.ts (fetch)                      │
└────────────────────────────────────┼─────────────────────────────┘
                                     │ /api/*  (Vite Proxy)
                                     ▼
┌───────────────────────────────────────────────────────────────────┐
│                    BACKEND (CAP Node.js)                         │
│                    Port 4004                                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  server.js (Custom Bootstrap)                                ││
│  │  Express-Middleware: Multer (File Upload), JSON Parser       ││
│  │  Routes: POST /api/documents/upload, /api/documents/start...││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌──────────────────────── CDS Services ───────────────────────┐│
│  │                                                              ││
│  │  ChatService (/api/chat)     → chat-service.js               ││
│  │  DocumentService (/api/docs) → document-service.js           ││
│  │  HCMService (/api/hcm)      → hcm-service.js                ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌──────────────────────── Agent Core ─────────────────────────┐│
│  │                                                              ││
│  │  agent-loop.js        → Orchestrierung (Workflow vs. LLM)   ││
│  │  workflow-engine.js   → Deterministische State-Machine      ││
│  │  agent-tools.js       → 14 Tool-Definitionen + Executoren   ││
│  │  state-store.js       → DB-basierte Workflow-State-Verw.    ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌──────────────────── Wissens- & Datenquellen ────────────────┐│
│  │                                                              ││
│  │  knowledge-base.js      → Lokale HR-Wissensbasis (11 Chunks)││
│  │  document-schemas.js    → Schema-Adapter (Produkte + Legacy)││
│  │  personalprodukte/      → Deklarative Produkt-Definitionen  ││
│  │  vw-doc-ai-client.js   → M2M OAuth2 Client für VW Doc AI   ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌──────────────────────── Datenschicht ───────────────────────┐│
│  │                                                              ││
│  │  db/schema.cds           → 8 CDS-Entities                   ││
│  │  db.sqlite               → SQLite Datenbank                  ││
│  │  db/data/*.json          → Seed-Daten (7 Mitarbeiter)        ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
                          │                    │
                          ▼                    ▼
                ┌─────────────────┐   ┌──────────────────┐
                │   OpenAI API    │   │   vw-doc-ai      │
                │   gpt-4o-mini / │   │   (SAP BTP)      │
                │   gpt-5-mini    │   │   Mistral OCR    │
                └─────────────────┘   └──────────────────┘
```

### 1.2 Technologie-Stack

| Schicht | Technologie | Version | Zweck |
|---------|-------------|---------|-------|
| Frontend | React | 19.x | UI-Framework |
| Frontend | Vite | 6.3 | Dev-Server + Bundler |
| Frontend | TypeScript | 5.8 | Typsicherheit |
| Frontend | react-markdown | 10.x | LLM-Antworten rendern |
| Backend | @sap/cds | 9.x | CAP Framework |
| Backend | Express | 4.x | HTTP-Middleware |
| Backend | Multer | 1.x | File-Upload |
| Backend | openai | 6.29+ | OpenAI API Client |
| Backend | pdf-parse | 1.1 | PDF-Textextraktion |
| Datenbank | @cap-js/sqlite | 2.x | SQLite-Adapter |
| LLM | OpenAI gpt-4o-mini / gpt-5-mini | — | Intent, Analyse, Konversation |
| Extraktion | vw-doc-ai (Mistral OCR) | — | Schema-basierte Dokumentenextraktion |

---

## 2. Verzeichnisstruktur

```
HR-Agent/
├── .env                          # Umgebungsvariablen (API Keys)
├── .env.example                  # Template für .env
├── package.json                  # Backend-Dependencies + Scripts
├── server.js                     # Custom CAP Bootstrap (Express + Multer)
├── eslint.config.mjs            # ESLint-Konfiguration
├── db.sqlite                     # SQLite-Datenbankdatei (generiert)
│
├── db/
│   ├── schema.cds                # CDS-Datenmodell (8 Entities)
│   └── data/
│       └── hr.agent-Employees.json   # Seed-Daten: 7 Mitarbeiter
│
├── srv/
│   ├── services.cds              # CDS-Service-Definitionen (3 Services)
│   ├── chat-service.js           # ChatService-Implementierung (~250 Zeilen)
│   ├── document-service.js       # DocumentService-Implementierung (~150 Zeilen)
│   ├── hcm-service.js            # HCMService-Implementierung (~100 Zeilen)
│   └── lib/
│       ├── agent-loop.js         # Agent-Orchestrierung (~280 Zeilen)
│       ├── agent-tools.js        # 14 Tool-Definitionen (~1400 Zeilen)
│       ├── workflow-engine.js    # Deterministische State-Machine (~850 Zeilen)
│       ├── state-store.js        # DB-basierter State-Store (~90 Zeilen)
│       ├── document-schemas.js   # Schema-Adapter (~545 Zeilen)
│       ├── knowledge-base.js     # HR-Wissensbasis (~250 Zeilen)
│       ├── vw-doc-ai-client.js   # M2M OAuth2 Client (~280 Zeilen)
│       └── personalprodukte/
│           ├── registry.js       # Produkt-Registry (~90 Zeilen)
│           └── fibu24.js         # Fibu24 Produkt (~200 Zeilen)
│
├── app/
│   ├── package.json              # Frontend-Dependencies
│   ├── vite.config.ts            # Vite-Konfiguration (Proxy, Port)
│   ├── tsconfig.json             # TypeScript-Konfiguration
│   ├── index.html                # HTML-Entry-Point
│   └── src/
│       ├── main.tsx              # React Entry-Point
│       ├── App.tsx               # Root-Komponente
│       ├── api.ts                # API-Client (~120 Zeilen)
│       ├── vite-env.d.ts         # Vite-Typ-Deklarationen
│       ├── styles/
│       │   └── global.css        # Globale Styles
│       └── components/
│           ├── ChatWindow.tsx    # Chat-Interface (~350 Zeilen)
│           ├── Navbar.tsx        # VW-Branding Header (~30 Zeilen)
│           ├── Topbar.tsx        # Navigation (~25 Zeilen)
│           └── FloatingTags.tsx  # Floating Action Buttons (~30 Zeilen)
│
├── tests/
│   ├── classify-intent.test.js   # Intent-Klassifikation (37 Tests)
│   ├── document-schemas.test.js  # Schema-Adapter (15 Tests)
│   └── state-store.test.js       # State-Store (4 Tests)
│
└── docs/
    ├── AGENT_ARCHITEKTUR_ENTSCHEIDUNG.md   # Custom BTP vs. Agentforce
    ├── WORKFLOW_ENGINE_VS_AGENTFORCE.md     # State Machine vs. Guided Autonomy
    ├── ARCHITECTURE.md                      # ← Dieses Dokument
    ├── PERSONALPRODUKTE.md
    ├── TOOLS_REFERENCE.md
    ├── WORKFLOW_ENGINE.md
    ├── DATA_MODEL.md
    ├── FRONTEND.md
    └── API_REFERENCE.md
```

---

## 3. Komponentenarchitektur

### 3.1 Server Bootstrap (`server.js`)

Der Custom CAP Server erweitert `cds.server` um Express-Middleware:

```
cds.on('bootstrap') → Express-App
  ├── express.json()           # JSON-Body-Parser
  ├── multer (memoryStorage)   # File-Upload (max 50 MB)
  │
  ├── POST /api/documents/upload            # Phase 1: Intake
  │   → SHA-256 Hash berechnen
  │   → Case + Document in DB anlegen
  │   → Buffer in global._pendingBuffers (10 Min TTL)
  │   → Return { documentId, caseId, status, phase }
  │
  └── POST /api/documents/startExtraction   # Phase 2: Schema-Bindung
      → Schema über resolveUploadConfig() auflösen
      → Document aktualisieren (documentType, schemaId)
      → vw-doc-ai Upload ODER Simulation
      → Return { documentId, jobId, status, schemaName }
```

**Warum Custom Bootstrap?**
- CDS-Actions unterstützen keinen multipart/form-data File-Upload
- Multer-Middleware verarbeitet die Datei im Memory (kein Disk-I/O)
- Der File-Buffer wird temporär in `global._pendingBuffers` gehalten

### 3.2 CDS-Services

Drei CDS-Services bilden die Business-API:

| Service | Pfad | Implementierung | Zweck |
|---------|------|-----------------|-------|
| `ChatService` | `/api/chat` | `chat-service.js` | Chat-Endpunkt, Session-Management, Agent-Orchestrierung |
| `DocumentService` | `/api/documents` | `document-service.js` | Dokumenten-Polling, Metadaten-basierte Extraktion |
| `HCMService` | `/api/hcm` | `hcm-service.js` | Mitarbeiter-Lookup, Aktionsvalidierung, Einreichung |

### 3.3 Agent Core

Der Agent-Kern besteht aus vier eng verzahnten Modulen:

```
                        ┌──────────────────────┐
                        │   chat-service.js    │
                        │   (Entry Point)      │
                        └──────────┬───────────┘
                                   │ runAgentLoop()
                                   ▼
                        ┌──────────────────────┐
                        │   agent-loop.js      │
                        │   (Orchestrator)     │
                        └───┬──────────┬───────┘
                            │          │
               Workflow?    │          │    Kein Workflow?
                            ▼          ▼
              ┌──────────────────┐  ┌──────────────────┐
              │ workflow-engine  │  │ OpenAI LLM Loop  │
              │ (State Machine)  │  │ (Free Chat)      │
              └───────┬──────────┘  └─────┬────────────┘
                      │                   │
                      ▼                   ▼
              ┌──────────────────────────────────┐
              │        agent-tools.js            │
              │        (14 Tools + Executor)     │
              └──────────────┬───────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌───────────┐ ┌───────────┐ ┌─────────────┐
        │ DB/SQLite │ │ OpenAI    │ │ vw-doc-ai   │
        │ (Entities)│ │ (Vision)  │ │ (Extraktion)│
        └───────────┘ └───────────┘ └─────────────┘
```

---

## 4. Zwei-Modi-Architektur

Der Agent arbeitet in **zwei grundlegend verschiedenen Modi**, je nachdem ob ein Personalprodukt-Workflow aktiv ist oder nicht.

### 4.1 Modus 1: Workflow-Modus (deterministisch)

**Trigger:** Ein aktiver Workflow existiert in der Cases-Tabelle ODER ein neuer Dokument-Upload wird erkannt.

**Ablauf:**
1. `agent-loop.js` prüft via `stateStore.loadState(sessionId)` ob ein aktiver Workflow existiert
2. Wenn ja → `executeWorkflowTurn()` aus `workflow-engine.js` wird aufgerufen
3. Die Workflow-Engine führt den nächsten deterministischen Schritt aus
4. Der neue State wird via `stateStore.saveState()` persistiert
5. Das LLM wird **nicht** für Entscheidungen genutzt (nur für Dokumentanalyse und Intent-Klassifikation)

**Philosophie:** Prozesskontrolle > Flexibilität. Das LLM entscheidet nie über den nächsten Workflow-Schritt.

### 4.2 Modus 2: LLM-Modus (freie Konversation)

**Trigger:** Kein aktiver Workflow, kein Dokument-Upload.

**Ablauf:**
1. `agent-loop.js` stellt fest: Kein Workflow aktiv
2. System-Prompt wird mit `buildSystemPrompt()` generiert
3. Nur eine Untermenge der Tools wird bereitgestellt:
   - `kb_search` – Wissensbasis durchsuchen
   - `kb_list_topics` – Verfügbare Themen auflisten
   - `hcm_get_employee` – Mitarbeiterdaten nachschlagen
   - `docai_list_document_types` – Verfügbare Dokumenttypen
   - `docai_check_status` – Service-Health prüfen
4. Max. 8 Iterations (Tool-Calls + LLM-Antworten)
5. `temperature: 0` mit Fallback wenn Modell es nicht unterstützt

**Philosophie:** Natürliche Konversation, KB-gestützte Antworten, keine Pipeline-Tools.

### 4.3 Modus-Entscheidung im agent-loop.js

```
runAgentLoop(openai, userMessage, history, tools, model, sessionId)
  │
  ├── 1. DB-State laden: stateStore.loadState(sessionId)
  │     └── Aktiver Workflow? → executeWorkflowTurn() → RETURN
  │
  ├── 2. Upload erkennen: parseUploadMessage(userMessage)
  │     ├── Produkt matchen: matchProduct(fileName, userMessage)
  │     │   └── Treffer? → executeWorkflowTurn('intake') → RETURN
  │     │
  │     ├── LLM-Analyse: executeTool('docai_analyze_document')
  │     │   └── Produkt erkannt? → Save State + RETURN
  │     │
  │     └── Nichts erkannt → User fragen mit getProductChoices()
  │
  └── 3. LLM-Modus: OpenAI mit gefiltertem Tool-Set
        └── Max 8 Iterations → RETURN
```

---

## 5. Datenfluss

### 5.1 Chat-Nachricht (ohne Upload)

```
[User] "Was muss ich bei Elternzeit beachten?"
  │
  ▼
ChatWindow.tsx → api.sendMessage(sessionId, message)
  │
  ▼ POST /api/chat/sendMessage
  │
ChatService.sendMessage()
  ├── Session laden/erstellen
  ├── User-Nachricht in Messages speichern
  ├── History laden (letzte 20 Nachrichten)
  │
  ▼
runAgentLoop()
  ├── stateStore.loadState() → null (kein Workflow)
  ├── parseUploadMessage() → null (kein Upload)
  ├── LLM-Modus:
  │   ├── buildSystemPrompt()
  │   ├── expandHistoryWithToolContext(history)
  │   ├── OpenAI completion → tool_call: kb_search("elternzeit")
  │   ├── executeTool('kb_search', {query: "elternzeit"})
  │   │   └── searchKnowledge("elternzeit") → 3 Chunks
  │   ├── Tool-Result → OpenAI completion → finale Antwort
  │   └── parseSuggestions() → Vorschläge extrahieren
  │
  ▼
ChatService
  ├── buildToolContext(toolCalls) → [TOOL_CONTEXT:...]
  ├── Assistant-Nachricht in Messages speichern
  └── Return { reply, sessionId, suggestions, toolCalls }
```

### 5.2 Dokument-Upload (mit Workflow)

```
[User] Datei "fibu24_fahrkarte.pdf" hochladen
  │
  ▼
ChatWindow.handleFileUpload(file)
  ├── api.uploadDocument(file, sessionId)
  │   └── POST /api/documents/upload (Express/Multer)
  │       ├── SHA-256 Hash
  │       ├── INSERT Cases (status: 'open')
  │       ├── INSERT Documents (phase: 'intake')
  │       ├── global._pendingBuffers[docId] = buffer
  │       └── Return { documentId, caseId }
  │
  ├── Synthetische Nachricht bauen:
  │   "Ein Dokument wurde hochgeladen (documentId: "...", caseId: "...", Datei: "...")"
  │
  ▼ api.sendMessage(sessionId, synthetischeNachricht)
  │
runAgentLoop()
  ├── stateStore.loadState() → null (neuer Workflow)
  ├── parseUploadMessage() → { documentId, caseId, fileName }
  ├── matchProduct("fibu24_fahrkarte.pdf", msg) → fibu24
  │
  ▼ executeWorkflowTurn(fibu24, ctx, 'intake', {})
  │
  │  TURN 1: intake
  │  ├── docai_analyze_document(documentId)
  │  │   └── PDF-Text extrahieren → GPT-4o Klassifikation
  │  ├── product.templates.hypothesis({analysis})
  │  └── State → 'awaiting_confirmation'
  │
  │  TURN 2: User "Ja, Erstattung vorbereiten"
  │  ├── classifyIntent("Ja, Erstattung vorbereiten") → 'confirm'
  │  ├── docai_start_extraction(documentId, "Fibu24-Nachweis")
  │  ├── docai_get_extraction(documentId)
  │  ├── Pflichtfelder prüfen → OK
  │  ├── lookupAndValidate()
  │  │   ├── hcm_get_employee({lastName: "Kirchhoff", firstName: "Andrea"})
  │  │   ├── product.validation(fields) → Cross-Check
  │  │   └── product.templates.extractionSummary()
  │  └── State → 'awaiting_approval'
  │
  │  TURN 3: User "Ja, einreichen"
  │  ├── classifyIntent() → 'confirm'
  │  ├── hcm_validate_action(fibu24_erstattung, payload)
  │  ├── hcm_submit_action(fibu24_erstattung, employeeId, payload)
  │  ├── product.templates.submitted()
  │  └── State → 'done'
```

---

## 6. State Management

### 6.1 Historische Entwicklung

| Phase | Methode | Problem |
|-------|---------|---------|
| v1 | `[WORKFLOW_STATE:{...}]` in Chat-Nachrichten | Regex-Parsing fragil, verschmutzt History |
| v2 (aktuell) | Cases-Tabelle (`workflowState`, `workflowData`) | Sauber, abfragbar, crash-sicher |

### 6.2 Aktuelle Implementierung (state-store.js)

```javascript
// Laden: Neuester aktiver Case der Session
loadState(sessionId) → { caseId, productId, state, documentId, data } | null
  // "Aktiv" = workflowState nicht 'done' und nicht 'cancelled'

// Speichern: Case-Tabelle aktualisieren
saveState(caseId, { productId, state, documentId, data }, sessionId)
  // data wird als JSON in workflowData serialisiert
  // documentId wird als data._documentId gespeichert

// Abbrechen: State auf 'cancelled' setzen
cancelState(caseId)
  // loadState() ignoriert danach diesen Case
```

### 6.3 Session-Architektur

```
ChatSession (1) ──→ (N) ChatMessages
                ──→ (N) Cases
                         ├── workflowState    (String: 'intake', 'done', ...)
                         ├── workflowData     (JSON: akkumulierte Daten)
                         ├── productId        (String: 'fibu24', ...)
                         ├── (N) Documents
                         ├── (N) CaseEvents   (Audit Trail)
                         └── (N) HCMActions
```

---

## 7. Externe Integrationen

### 7.1 OpenAI API

| Parameter | Wert | Hinweis |
|-----------|------|---------|
| Modell | `process.env.OPENAI_MODEL` oder `gpt-4o-mini` | Konfigurierbar |
| Temperature | `0` (mit Fallback) | gpt-5-mini unterstützt kein `temperature:0` |
| Seed | `42` | Determinismus (nur gpt-4o-*) |
| max_completion_tokens | `100` (Intent) | gpt-5-mini: Reasoning-Tokens fressen Budget |
| Fallback | Regelbasierte Antworten | Wenn kein API-Key konfiguriert |

**Bekannte gpt-5-mini Einschränkungen:**
- Kein `temperature: 0` → Parameter wird bei 400-Fehler entfernt
- Kein `response_format: json_object` → Nur Text-Responses
- Kein `max_tokens` → Muss `max_completion_tokens` verwendet werden
- Reasoning-Tokens belegen Budget → min. 100 Tokens für einfache Klassifikation

### 7.2 vw-doc-ai

| Parameter | Umgebungsvariable | Zweck |
|-----------|-------------------|-------|
| Backend-URL | `VW_DOCAI_URL` | CAP-Service auf BTP |
| XSUAA-URL | `VW_DOCAI_XSUAA_URL` | OAuth2 Token-Endpoint |
| Client-ID | `VW_DOCAI_CLIENT_ID` | M2M-Authentifizierung |
| Client-Secret | `VW_DOCAI_CLIENT_SECRET` | M2M-Authentifizierung |
| App-ID | `VW_DOCAI_CLIENT_APP_ID` | Mandantentrennung (`hr-agent`) |

**Fallback:** Wenn vw-doc-ai nicht konfiguriert oder nicht erreichbar → Simulationsmodus mit vordefinierten Extraktionsdaten.

---

## 8. Entwicklung & Betrieb

### 8.1 NPM-Scripts

| Script | Befehl | Beschreibung |
|--------|--------|--------------|
| `npm run dev` | `npm run db:deploy && cds watch` | Backend starten (Port 4004) |
| `npm run dev:app` | `cd app && npm run dev` | Frontend starten (Port 5173) |
| `npm test` | `node --test tests/` | 56 Tests ausführen |
| `npm run db:deploy` | `cds deploy --to sqlite:db.sqlite` | Schema deployen |
| `npm run build:app` | `cd app && npm run build` | Frontend-Build |

### 8.2 Umgebungsvariablen (.env)

```bash
# Erforderlich für LLM-Funktionalität
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini    # oder gpt-5-mini

# Optional: vw-doc-ai (ohne = Simulationsmodus)
VW_DOCAI_URL=https://vw-doc-ai-srv.cfapps.eu10-004.hana.ondemand.com
VW_DOCAI_XSUAA_URL=https://...authentication.eu10.hana.ondemand.com
VW_DOCAI_CLIENT_ID=
VW_DOCAI_CLIENT_SECRET=
VW_DOCAI_CLIENT_APP_ID=hr-agent
```

### 8.3 Tests

| Testdatei | Tests | Scope |
|-----------|-------|-------|
| `classify-intent.test.js` | 37 | 31 Regex + 6 LLM-Mock |
| `document-schemas.test.js` | 15 | Schema-Adapter, Validierung |
| `state-store.test.js` | 4 | Load, Save, Cancel |
| **Gesamt** | **56** | |

Framework: Node.js Built-in `node:test` (kein Jest/Mocha nötig).

---

## 9. Bekannte Einschränkungen & Technische Schulden

| Thema | Status | Details |
|-------|--------|---------|
| `global._pendingBuffers` | ⚠️ Technische Schuld | File-Buffers im Prozessspeicher, 10 Min TTL → sollte DB BLOB werden |
| `agent-tools.js` | ⚠️ Monolith | ~1400 Zeilen, alle 14 Tools in einer Datei → aufteilen |
| Rigid State Machine | ⚠️ Architektur-Limitation | Jeder Edge-Case erfordert State/Transition-Erweiterung → Guided Autonomy prüfen |
| Legacy-Schemas | ⚠️ Migration ausstehend | 5 Schemas noch in document-schemas.js statt als Produkt-Dateien |
| TypeScript Backend | ❌ Nicht umgesetzt | Backend ist JavaScript, Frontend ist TypeScript |
| Embedding-Suche | ❌ Nicht umgesetzt | KB nutzt Keyword-Matching statt Vektorsuche |
| Authentifizierung | ❌ Nicht umgesetzt | Kein User-Auth, keine XSUAA-Integration |
| Multitenancy | ❌ Nicht umgesetzt | Kein Mandanten-Konzept |

---

## 10. Verwandte Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [PERSONALPRODUKTE.md](PERSONALPRODUKTE.md) | Wie Personalprodukte definiert und erweitert werden |
| [WORKFLOW_ENGINE.md](WORKFLOW_ENGINE.md) | State-Machine, Zustände, Übergänge, Intent-Klassifikation |
| [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md) | Alle 14 Tools: Signatur, Parameter, Rückgabe |
| [DATA_MODEL.md](DATA_MODEL.md) | CDS-Datenmodell, Entities, Beziehungen |
| [FRONTEND.md](FRONTEND.md) | React-App, Komponenten, API-Client |
| [API_REFERENCE.md](API_REFERENCE.md) | Alle HTTP-Endpunkte mit Request/Response |
| [AGENT_ARCHITEKTUR_ENTSCHEIDUNG.md](AGENT_ARCHITEKTUR_ENTSCHEIDUNG.md) | Custom BTP Agent vs. Salesforce Agentforce |
| [WORKFLOW_ENGINE_VS_AGENTFORCE.md](WORKFLOW_ENGINE_VS_AGENTFORCE.md) | State Machine vs. Guided Autonomy |
