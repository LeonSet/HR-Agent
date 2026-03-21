# Workflow-Engine – Deterministische Prozesssteuerung

> **Datei:** `srv/lib/workflow-engine.js` (~850 Zeilen)  
> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [PERSONALPRODUKTE.md](PERSONALPRODUKTE.md) · [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md)

---

## 1. Konzept

Die Workflow-Engine ist eine **deterministische State-Machine**, die den Ablauf aller Personalprodukte steuert. Das LLM wird **nie** für Prozessentscheidungen verwendet – nur für:

1. **Dokumentanalyse** (`docai_analyze_document` → GPT-4o mit Vision/PDF-Text)
2. **Intent-Klassifikation** (`classifyIntent()` → LLM mit Regex-Fallback)

Alle anderen Entscheidungen (nächster Schritt, Validierung, Rückfragen, Templates) sind hart codiert.

### 1.1 Designphilosophie

```
Prozesskontrolle > Flexibilität > Natürlichkeit
```

- **Pro:** 100% deterministische Abläufe, auditierbar, vorhersagbar
- **Contra:** Jeder Edge-Case erfordert Code-Änderung, kein adaptives Verhalten

### 1.2 Bekannte Limitation

> *"Mir scheint es langsam, dass diese rigid workflow engine nicht passend ist für ein echtes AI Agent system."*

Siehe [WORKFLOW_ENGINE_VS_AGENTFORCE.md](WORKFLOW_ENGINE_VS_AGENTFORCE.md) für die Analyse und den Vergleich mit "Guided Autonomy".

---

## 2. Zustandsdiagramm

```
                    ┌──────────┐
                    │  intake  │ ◄──── Neuer Dokument-Upload
                    └────┬─────┘
                         │ docai_analyze_document()
                         ▼
               ┌─────────────────────┐
               │ awaiting_confirmation│ ◄──── Hypothese präsentiert
               └────┬──────┬────┬────┘
                    │      │    │
          deny/     │ confirm/  │ unclear
          cancel    │ extract   │
                    │ _only     │
          ┌─────┐  │      ┌────┴───────────┐
          │cncld│  │      │ Klare Optionen │
          └─────┘  │      │ anbieten       │
                   │      └────────────────┘
                   ▼
         docai_start_extraction() + docai_get_extraction()
                   │
         ┌─────────┴──────────┐
         │                    │
         ▼                    ▼
  ┌──────────────┐    ┌───────────────┐
  │awaiting_fields│    │ Pflichtfelder │
  │(Felder fehlen)│    │ vorhanden     │
  └──────┬───────┘    └───────┬───────┘
         │ User liefert       │
         │ Werte nach         │
         └────────┬───────────┘
                  │ lookupAndValidate()
                  │
         ┌────────┴──────────┐
         │                   │
         ▼                   ▼
  ┌────────────────┐  ┌──────────────────┐
  │awaiting_employee│  │ Mitarbeiter     │
  │(MA nicht gefund.)│  │ gefunden       │
  └──────┬─────────┘  └──────┬──────────┘
         │ PNR eingeben       │
         │ + Name-Cross-Check │
         └────────┬───────────┘
                  │ product.templates.extractionSummary()
                  ▼
        ┌──────────────────┐
        │ awaiting_approval │ ◄──── Zusammenfassung gezeigt
        └──┬──────┬────┬───┘
           │      │    │
     deny  │ confirm  │ correct
           │      │    │
     ┌─────┘      │    └───────────────┐
     ▼            │                    ▼
  ┌──────┐        │           ┌──────────────────┐
  │cncld │        │           │awaiting_correction│
  └──────┘        │           └────────┬─────────┘
                  │                    │ Korrektur-Werte
                  │                    │ → lookupAndValidate()
                  ▼                    └──────────┘
       hcm_validate_action() + hcm_submit_action()
                  │
                  ▼
              ┌──────┐
              │ done │
              └──────┘
```

---

## 3. Zustände im Detail

### 3.1 `intake`

**Trigger:** Neuer Dokument-Upload erkannt, Produkt gematcht.

**Ablauf:**
1. `docai_analyze_document(documentId, userMessage)` aufrufen
2. Analyse in `data.analysis` speichern
3. `product.templates.hypothesis()` aufrufen
4. Transition → `awaiting_confirmation`

**Tool-Calls:** `docai_analyze_document`  
**User-Interaktion:** Keine (automatisch)

---

### 3.2 `awaiting_confirmation`

**Trigger:** Hypothese wurde dem User präsentiert.

**Ablauf:**
1. `classifyIntent(userMessage)` → Intent bestimmen
2. Switch:
   - `deny` → Abbruch, Produktauswahl anbieten → `cancelled`
   - `unclear` → Klare 3 Optionen anbieten → bleibt `awaiting_confirmation`
   - `confirm` / `extract_only`:
     1. `docai_start_extraction(documentId, documentType)` aufrufen
     2. `docai_get_extraction(documentId)` aufrufen
     3. Pflichtfelder prüfen:
        - Fehlende Felder? → `awaiting_fields`
        - Alle da? → `lookupAndValidate()` → `awaiting_approval` oder `awaiting_employee`

**Tool-Calls:** `docai_start_extraction`, `docai_get_extraction`  
**User-Interaktion:** Bestätigung / Ablehnung / Klärung

---

### 3.3 `awaiting_fields`

**Trigger:** Pflichtfelder fehlen nach Extraktion.

**Ablauf:**
1. `classifyIntent()` → `deny`? → `cancelled`
2. Fehlende Felder identifizieren
3. User-Input parsen:
   - 1 Feld fehlt → gesamte Nachricht als Wert
   - Mehrere Felder → Pattern `Feld: Wert` erkennen
4. Extrahierte Felder aktualisieren
5. → `lookupAndValidate()`

**Parsing-Logik:**
```
"Kirchhoff"              → Wenn 1 Feld fehlt: Wert = "Kirchhoff"
"Vorname: Andrea"        → Feld-Wert-Zuordnung
"Vorname: Andrea\n       → Mehrere Felder auf einmal
 Nachname: Kirchhoff"
```

**Tool-Calls:** Keine direkt (nur via `lookupAndValidate()`)  
**User-Interaktion:** Fehlende Werte eingeben

---

### 3.4 `awaiting_employee`

**Trigger:** Mitarbeiter konnte nicht über extrahiertes Feld gefunden werden.

**Ablauf:**
1. `classifyIntent()` → `deny`? → `cancelled`
2. Personalnummer aus Nachricht extrahieren (`/\d{6,8}/`)
3. Wenn PNR gefunden:
   a. `hcm_get_employee({personnelNumber})` aufrufen
   b. Wenn gefunden: **Name-Cross-Check**
      - Dokument-Name ≠ MA-Name? → Warnung, bleibt `awaiting_employee`
      - Dokument-Name = MA-Name? → `data.employee` setzen → `awaiting_approval`
4. Wenn nicht gefunden → "Kein MA mit dieser Nummer" → bleibt `awaiting_employee`

**Name-Cross-Check (Detail):**
```javascript
const docLastName = fields.find(f => /nachname/i.test(f.fieldName));
const docFirstName = fields.find(f => /vorname/i.test(f.fieldName));

const lastNameMismatch = docLastName &&
  docLastName.fieldValue.toLowerCase() !== empName.lastName.toLowerCase();
const firstNameMismatch = docFirstName &&
  docFirstName.fieldValue.toLowerCase() !== empName.firstName.toLowerCase();

if (lastNameMismatch || firstNameMismatch) {
  // → "PNR 00012345 ist Max Mustermann, aber im Dokument steht Andrea Kirchhoff"
}
```

**Tool-Calls:** `hcm_get_employee`  
**User-Interaktion:** Personalnummer eingeben

---

### 3.5 `awaiting_correction`

**Trigger:** User will Daten korrigieren (aus `awaiting_approval`).

**Ablauf:**
1. Extrahierte Felder laden
2. `Feld: Wert` Muster aus der Nachricht parsen
3. Felder aktualisieren
4. → `lookupAndValidate()` (Re-Validierung)

**Tool-Calls:** Via `lookupAndValidate()`  
**User-Interaktion:** Korrektur-Werte im Format "Feldname: Wert"

---

### 3.6 `awaiting_approval`

**Trigger:** Zusammenfassung mit extrahierten Daten + Mitarbeiter gezeigt.

**Ablauf:**
1. `classifyIntent()` → Intent bestimmen
2. Switch:
   - `deny` → `cancelled`
   - `correct` → Feld-Liste zeigen, Korrekturformat erklären → `awaiting_correction`
   - `unclear` / `extract_only` → "Einreichen, korrigieren oder abbrechen?" → bleibt
   - `confirm`:
     1. Payload aus Feldern bauen
     2. `hcm_validate_action(actionType, payload)` aufrufen
     3. Wenn nicht valid → `product.templates.validationFailed()` → bleibt
     4. Wenn valid → `hcm_submit_action(actionType, employeeId, payload)`
     5. `product.templates.submitted()` → `done`

**Tool-Calls:** `hcm_validate_action`, `hcm_submit_action`  
**User-Interaktion:** Einreichung bestätigen / Korrektur / Abbruch

---

### 3.7 `done`

**Terminal-Zustand.** `loadState()` ignoriert Cases mit `workflowState = 'done'`.

---

### 3.8 `cancelled`

**Terminal-Zustand.** `loadState()` ignoriert Cases mit `workflowState = 'cancelled'`. Wird gesetzt durch:
- `cancelState(caseId)` → UPDATE Cases SET workflowState='cancelled'
- Oder direkt via workflowState in der Return-Struktur

---

## 4. Hilfsfunktion: `lookupAndValidate()`

Zentrale Funktion, die von `awaiting_confirmation`, `awaiting_fields` und `awaiting_correction` aufgerufen wird.

**Ablauf:**

```
1. Lookup-Feld aus Produkt-Definition: product.employee.lookupField
   (z.B. "Nachname")

2. Wert in extrahierten Feldern finden

3. Suchparameter bestimmen:
   ├── lookupType = 'personnelNumber' → { personnelNumber: value }
   └── lookupType = 'lastName' → { lastName: value }
       + Wenn Vorname extrahiert → { firstName: vornameValue }

4. hcm_get_employee(searchParams) aufrufen

5. Wenn gefunden → data.employee setzen

6. product.validation(fields) → Cross-Validierung

7. Wenn KEIN Mitarbeiter gefunden:
   → product.templates.employeeNotFound() → 'awaiting_employee'

8. Wenn Mitarbeiter gefunden:
   → product.templates.extractionSummary() → 'awaiting_approval'
```

---

## 5. Intent-Klassifikation

### 5.1 Fünf Intent-Kategorien

| Intent | Bedeutung | Beispiele |
|--------|-----------|-----------|
| `confirm` | Zustimmung, weiter | "Ja", "Ok", "Mach das", "Einreichen", "Weiter" |
| `deny` | Ablehnung, Abbruch | "Nein", "Abbrechen", "Stopp", "Nicht richtig" |
| `extract_only` | Nur Daten zeigen | "Nur Daten zeigen", "Nein, nur prüfen" |
| `correct` | Daten korrigieren | "Korrigieren", "Ändern", "Datum stimmt nicht" |
| `unclear` | Keiner der obigen | Fragen, Kommentare, Unverständliches |

### 5.2 LLM-basierte Klassifikation

```javascript
async function classifyIntent(msg, openai, model) {
  // 1. LLM versuchen (wenn vorhanden)
  if (openai && model) {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: msg },
      ],
      max_completion_tokens: 100,  // gpt-5-mini braucht min. 100 wegen Reasoning-Tokens
    });
    const raw = completion.choices[0]?.message?.content?.trim().toLowerCase();
    // Intent aus Response extrahieren
    const intent = VALID_INTENTS.find(i => raw.includes(i));
    if (intent) return intent;
    // Fallback bei leerem/unbekanntem Result
  }

  // 2. Regex-Fallback
  return classifyIntentRegex(msg);
}
```

**System-Prompt:**
```
Du bist ein Intent-Klassifikator für einen HR-Workflow.
Klassifiziere die Benutzer-Nachricht in GENAU EINE Kategorie:
- confirm: Zustimmung, Bestätigung, weiter machen, einreichen, vorbereiten
- deny: Ablehnung, Abbruch, Stopp
- extract_only: Nur Daten anzeigen/prüfen, ohne Aktion
- correct: Daten korrigieren, ändern, anpassen
- unclear: Passt in keine Kategorie
Antworte NUR mit dem Kategorie-Namen.
```

### 5.3 Regex-Fallback (`classifyIntentRegex`)

**Reihenfolge (Priorität):**

```
1. /korrigier|änder|bearbeit|anpass/           → 'correct'
2. /^nein\b/
   + /nur|zeig|sag|welche|daten|prüf|.../     → 'extract_only'
   sonst                                       → 'deny'
3. /^(no|falsch|stimmt nicht|abbrech|stopp)/   → 'deny'
4. /nur.+daten|daten.+prüf|welche.+daten/     → 'extract_only'
5. /^(ja|yes|ok|genau|richtig|stimmt|...)/     → 'confirm'
6. /einreich|verbuch|vorbereiten|verarbeit/    → 'confirm'
7. Sonst                                       → 'unclear'
```

### 5.4 Tests (37 Stück)

| Gruppe | Anzahl | Scope |
|--------|--------|-------|
| Regex: confirm | 7 | "Ja", "Ok", "Mach das", "Einreichen", ... |
| Regex: deny | 7 | "Nein", "Abbrechen", "Cancel", "Falsch", ... |
| Regex: extract_only | 6 | "Nur Daten zeigen", "Nein, nur prüfen", ... |
| Regex: correct | 4 | "Korrigieren", "Ändern", "Anpassen", ... |
| Regex: unclear | 7 | "Wie viel Urlaub?", "Was ist los?", ... |
| LLM-Mock | 6 | Mockt OpenAI-Response, testet Fallback |

---

## 6. Upload-Erkennung (`parseUploadMessage`)

Das Frontend sendet bei Uploads eine synthetische Nachricht:

```
Ein Dokument wurde hochgeladen (documentId: "abc-123", caseId: "def-456", Datei: "ticket.pdf")
```

Die Engine extrahiert per Regex:
```javascript
const docMatch  = userMessage.match(/documentId:\s*"([^"]+)"/);
const caseMatch = userMessage.match(/caseId:\s*"([^"]+)"/);
const fileMatch = userMessage.match(/Datei:\s*"([^"]+)"/);
```

**Return:** `{ documentId, caseId, fileName }` oder `null`

---

## 7. Workflow-State Persistierung

### 7.1 Return-Struktur von executeWorkflowTurn

Jeder Case im Switch gibt zurück:

```javascript
{
  reply: string,              // Text-Antwort an User
  suggestions: string[],      // Vorschläge-Chips
  toolCalls: ToolCall[],      // Ausgeführte Tools (für UI)
  workflowState: {            // Neuer State (oder null = Workflow beendet)
    productId: string,
    state: string,            // Neuer Zustandsname
    documentId: string,
    caseId: string,
    data: object,             // Akkumulierte Daten
  } | null
}
```

### 7.2 State-Persistierung im agent-loop.js

```javascript
// Normaler Fall: State speichern
if (result.workflowState) {
  await stateStore.saveState(caseId, result.workflowState, sessionId);
}

// Abbruch: workflowState = null → cancelState()
if (!result.workflowState && savedState.caseId) {
  await stateStore.cancelState(savedState.caseId);
}
```

### 7.3 Akkumulierte Daten (`data`)

Die `data`-Struktur wächst im Laufe des Workflows:

| State | Neue Daten | Gesamt |
|-------|-----------|--------|
| `intake` | `data.analysis` | `{analysis}` |
| `awaiting_confirmation` | `data.extraction` | `{analysis, extraction}` |
| `awaiting_fields` | Update `data.extraction.extractedFields` | `{analysis, extraction}` |
| `lookupAndValidate` | `data.employee`, `data.validationResult` | `{analysis, extraction, employee, validationResult}` |
| `awaiting_correction` | Update Felder | Gleich |
| `awaiting_approval` | – | Gleich |

---

## 8. Exportierte Funktionen

| Funktion | Signatur | Beschreibung |
|----------|----------|--------------|
| `executeWorkflowTurn(product, ctx, currentState, stateData)` | Async | Hauptfunktion: Einen Workflow-Turn ausführen |
| `parseUploadMessage(userMessage)` | Sync | Upload-Nachricht parsen |
| `classifyIntent(msg, openai, model)` | Async | LLM-basierte Intent-Klassifikation |
| `classifyIntentRegex(msg)` | Sync | Regex-basierte Intent-Klassifikation |

### `ctx`-Parameter von executeWorkflowTurn:

```javascript
{
  documentId: string,     // UUID des Dokuments
  caseId: string,         // UUID des Cases
  fileName: string,       // Dateiname (nur bei intake)
  userMessage: string,    // Aktuelle User-Nachricht
  tools: Object,          // Tool-Registry (für executeTool())
  history: Array,         // Chat-Historie
  openai: Object,         // OpenAI Client (für classifyIntent)
  model: string,          // Modell (für classifyIntent)
}
```
