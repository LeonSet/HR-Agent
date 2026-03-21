# Personalprodukte – Architektur & Erweiterung

> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [WORKFLOW_ENGINE.md](WORKFLOW_ENGINE.md)

---

## 1. Konzept

Ein **Personalprodukt** ist eine vollständige, deklarative Definition eines HR-Prozesses. Es beschreibt alles, was der Agent für die Verarbeitung eines bestimmten Dokumenttyps wissen muss – von der Erkennung über die Extraktion bis zur HCM-Einreichung.

**Designprinzip:** Ein Personalprodukt ist eine reine Konfigurationsdatei. Kein neuer Code in der Workflow-Engine, kein neues Tool. Die Engine führt das Produkt aus, das Produkt liefert die Parameter.

### 1.1 Was ein Personalprodukt definiert

| Bereich | Beschreibung | Beispiel (Fibu24) |
|---------|-------------|-------------------|
| **Identität** | ID, Label, Beschreibung | `fibu24`, "Fibu24-Nachweis (Fahrkarten-Erstattung)" |
| **Erkennung** | Trigger-Keywords für Upload-Matching | `['fibu24', 'fahrkarte', 'deutschlandticket', ...]` |
| **vw-doc-ai** | Schema-Konfiguration für Extraktion | `schemaName: 'Fibu24_Schema'`, `schemaId: '60ae4d9b-...'` |
| **Mitarbeiter** | Welches Feld → welcher Lookup-Typ | `lookupField: 'Nachname'`, `lookupType: 'lastName'` |
| **HCM-Aktion** | Typ der HR-Aktion für Einreichung | `hcmAction: 'fibu24_erstattung'` |
| **Pflichtfelder** | Welche Felder extrahiert sein müssen | `[{field: 'Vorname', prompt: '...'}, ...]` |
| **Validierung** | Deterministische Plausibilitätsprüfungen | Datumsreihenfolge, Name vorhanden, Zeitraum < 1 Jahr |
| **Business-Checks** | Info-Liste für Validierungsbericht | `['Name stimmt überein', 'Erstattungsanspruch besteht']` |
| **Templates** | Feste Antwort-Texte für jeden Workflow-Schritt | `hypothesis()`, `extractionSummary()`, `submitted()` |
| **Simulation** | Test-/Demo-Daten für Extraktion | `simulatedExtraction: { headerFields: [...] }` |

---

## 2. Dateisystem-Struktur

```
srv/lib/personalprodukte/
├── registry.js       # Zentrale Registry: Laden, Matching, Auflistung
├── fibu24.js         # ✅ Migriertes Produkt: Fahrkarten-Erstattung
├── elternzeit.js     # ❌ Noch nicht migriert (in document-schemas.js)
├── krankmeldung.js   # ❌ Noch nicht migriert
├── reisekosten.js    # ❌ Noch nicht migriert
└── arbeitsvertrag.js # ❌ Noch nicht migriert
```

---

## 3. Registry (`registry.js`)

Die Registry ist der zentrale Zugriffspunkt für alle Produkte.

### 3.1 Registrierung

```javascript
const fibu24 = require('./fibu24');

const PRODUCTS = [
  fibu24,
  // require('./elternzeit'),
  // require('./krankmeldung'),
];
```

### 3.2 Exportierte Funktionen

| Funktion | Signatur | Beschreibung |
|----------|----------|--------------|
| `getProduct(id)` | `(string) → Product \| null` | Produkt per ID finden |
| `matchProduct(fileName, userMessage)` | `(string, string) → {product, matchedTriggers} \| null` | Produkt per Trigger-Matching finden |
| `listProducts()` | `() → Product[]` | Alle Produkte als Übersicht (für System-Prompt) |
| `getProductChoices()` | `() → string[]` | Produkt-Labels als Auswahl-Optionen |
| `findProductByLabel(label)` | `(string) → Product \| null` | Produkt per Label (User-Auswahl) |

### 3.3 Matching-Algorithmus (`matchProduct`)

```
Input: fileName + userMessage → toLowerCase()

Für jedes registrierte Produkt:
  → triggers.filter(trigger → input.includes(trigger))
  → Wenn ≥1 Trigger matcht: Return {product, matchedTriggers}

Return null (kein Match)
```

**Reihenfolge:** Erstes Produkt mit Match gewinnt (PRODUCTS-Array-Reihenfolge).

---

## 4. Produkt-Schema (Vollständige Referenz)

### 4.1 Pflichtfelder

```javascript
module.exports = {
  // ─── Identität ────────────────────────────────────────
  id: 'fibu24',                                    // Eindeutige ID (Maschinenlesbar)
  label: 'Fibu24-Nachweis (Fahrkarten-Erstattung)', // Anzeigename
  description: 'Beschreibung für den Nutzer',      // Kurzbeschreibung

  // ─── Erkennung ────────────────────────────────────────
  triggers: [                                      // Case-insensitive Keyword-Matching
    'fibu24', 'fahrkarte', 'monatskarte', ...
  ],

  // ─── vw-doc-ai ────────────────────────────────────────
  docai: {
    schemaName: 'Fibu24_Schema',                   // Schema-Name in vw-doc-ai
    schemaId: '60ae4d9b-...',                      // Schema-UUID (für API-Aufrufe)
    documentType: 'custom',                        // 'custom' | vw-doc-ai Standard-Typen
  },

  // ─── Mitarbeiter-Lookup ───────────────────────────────
  employee: {
    lookupField: 'Nachname',                       // Feldname der Extraktion
    lookupType: 'lastName',                        // 'lastName' | 'personnelNumber'
  },

  // ─── HCM-Aktion ──────────────────────────────────────
  hcmAction: 'fibu24_erstattung',                  // actionType für HCMActions-Entity

  // ─── Pflichtfelder ────────────────────────────────────
  requiredFields: [
    {
      field: 'Vorname',                            // Muss in extractedFields vorhanden sein
      prompt: 'Wie lautet der **Vorname**?',       // Rückfrage wenn fehlend
    },
    { field: 'Nachname', prompt: '...' },
    { field: 'Gültig ab Datum', prompt: '...' },
    { field: 'Gültig bis Datum', prompt: '...' },
  ],

  // ─── Cross-Validierung ────────────────────────────────
  validation(fields) {
    // Erhält Array von {fieldName, fieldValue, confidence, ...}
    // Returns: { issues: string[], valid: string[] }
  },

  // ─── Business-Checks ─────────────────────────────────
  businessChecks: [
    'Name auf Fahrkarte stimmt mit Mitarbeiter überein',
    'Erstattungsanspruch besteht',
    ...
  ],

  // ─── Templates ────────────────────────────────────────
  templates: {
    hypothesis(ctx)          { ... },  // Nach Analyse → {text, suggestions}
    extractionSummary(ctx)   { ... },  // Nach Extraktion + Validierung
    missingFields(list)      { ... },  // Fehlende Pflichtfelder
    employeeNotFound(ctx)    { ... },  // Kein MA gefunden → PNR fragen
    submitted()              { ... },  // Einreichung erfolgreich
    validationFailed(issues) { ... },  // Validierung fehlgeschlagen
  },

  // ─── Simulation ───────────────────────────────────────
  simulatedExtraction: {
    headerFields: [
      { name: 'Vorname', value: 'Andrea', confidence: 0.94, page: 1 },
      ...
    ],
    lineItems: [],
  },
};
```

### 4.2 Template-Funktionen im Detail

Jedes Template erhält Kontext (`ctx`) und gibt `{ text: string, suggestions: string[] }` zurück.

#### `hypothesis(ctx)`
- **Aufgerufen in:** `intake` → `awaiting_confirmation`
- **Kontext:** `ctx.analysis` (Ergebnis von `docai_analyze_document`)
- **Zweck:** Dem User die Erkennungs-Hypothese präsentieren
- **Confidence-Handling:**
  - `≥ 0.6`: "Das sieht nach einem **Fibu24-Nachweis** aus..."
  - `< 0.6`: "Das könnte ein **Fibu24-Nachweis** sein, aber..."

#### `extractionSummary(ctx)`
- **Aufgerufen in:** `lookupAndValidate()` → Transition zu `awaiting_approval`
- **Kontext:** `ctx.extraction`, `ctx.employee`, `ctx.validationResult`
- **Zweck:** Extrahierte Daten + Validierung + Mitarbeiter zusammenfassen
- **Inhalt:** Feldliste (Markdown), Validierungs-Status, Mitarbeiter-Match

#### `missingFields(list)`
- **Aufgerufen in:** `awaiting_confirmation` nach Extraktion
- **Kontext:** Array von `{ field, prompt }` (fehlende Pflichtfelder)
- **Zweck:** Gezielte Rückfragen zu fehlenden Feldern

#### `employeeNotFound(ctx)`
- **Aufgerufen in:** `lookupAndValidate()` wenn kein MA gefunden
- **Kontext:** `ctx.extraction` (für Name-Hinweis)
- **Zweck:** Personalnummer nachfragen

#### `submitted()`
- **Aufgerufen in:** `awaiting_approval` → `done`
- **Kontext:** Keiner nötig
- **Zweck:** Erfolgsbestätigung

#### `validationFailed(issues)`
- **Aufgerufen in:** `awaiting_approval` wenn `hcm_validate_action` fehlschlägt
- **Kontext:** Array von Validierungs-Fehlermeldungen
- **Zweck:** Probleme auflisten, Korrektur anbieten

---

## 5. Fibu24 – Referenzimplementierung

### 5.1 Trigger-Keywords (19 Stück)

```
fibu24, fahrkarte, monatsabo, abo-nachweis, jobticket,
deutschlandticket, abo, öpnv, pendlernachweis, monatsticket,
nahverkehr, bahncard, ticket, monatskarte, zeitkarte,
db-ticket, db-fahrkarte, deutsche bahn, bahn
```

**Bewusst ausgeschlossen:** `'db'` (matcht zu viele Dateinamen wie `db.sqlite`).

### 5.2 Pflichtfelder

| Feld | Prompt bei fehlendem Feld |
|------|--------------------------|
| Vorname | "Wie lautet der **Vorname** des Fahrkarten-Inhabers?" |
| Nachname | "Wie lautet der **Nachname** des Fahrkarten-Inhabers?" |
| Gültig ab Datum | "Ab wann ist die Fahrkarte **gültig** (Datum)?" |
| Gültig bis Datum | "Bis wann ist die Fahrkarte **gültig** (Datum)?" |

### 5.3 Validierungslogik

```
validation(fields):
  1. Gültig-ab und Gültig-bis vorhanden?
     → Ja: Datumsvergleich
       → von > bis? → Issue: "Gültigkeit-Von liegt nach Gültigkeit-Bis"
       → Differenz > 366 Tage? → Issue: "über 1 Jahr – ungewöhnlich"
       → OK → Valid: "Gültigkeitszeitraum: X Tage"

  2. Vorname + Nachname vorhanden?
     → Ja → Valid: "Inhaber: Vorname Nachname"
     → Nein → Issue: "Kein Name des Inhabers extrahiert"

  Return: { issues: [...], valid: [...] }
```

### 5.4 Simulierte Extraktionsdaten

| Feld | Wert | Confidence |
|------|------|------------|
| Vorname | Andrea | 0.94 |
| Nachname | Kirchhoff | 0.93 |
| Gültig ab Datum | 2023-01-01 | 0.96 |
| Gültig bis Datum | 2023-12-31 | 0.95 |

→ Matcht die Seed-Mitarbeiterin **Andrea Kirchhoff** (PNR: 04237442).

---

## 6. Neues Personalprodukt hinzufügen

### Schritt 1: Produkt-Datei erstellen

```bash
# Neue Datei anlegen
touch srv/lib/personalprodukte/elternzeit.js
```

### Schritt 2: Produkt definieren

```javascript
// srv/lib/personalprodukte/elternzeit.js
module.exports = {
  id: 'elternzeit',
  label: 'Elternzeit-Antrag',
  description: 'Antrag auf Elternzeit gemäß BEEG §16',

  triggers: [
    'elternzeit', 'elternzeit-antrag', 'beeg',
    'mutterschutz', 'vaterzeit', 'baby',
  ],

  docai: {
    schemaName: 'Elternzeit_Schema',
    schemaId: null,         // Noch kein vw-doc-ai Schema → Simulation
    documentType: 'custom',
  },

  employee: {
    lookupField: 'Nachname',
    lookupType: 'lastName',
  },

  hcmAction: 'elternzeit',

  requiredFields: [
    { field: 'Vorname',   prompt: 'Wie heißt der/die Antragsteller/in (Vorname)?' },
    { field: 'Nachname',  prompt: 'Wie heißt der/die Antragsteller/in (Nachname)?' },
    { field: 'Beginn',    prompt: 'Wann soll die Elternzeit **beginnen**?' },
    { field: 'Ende',      prompt: 'Wann soll die Elternzeit **enden**?' },
  ],

  validation(fields) {
    const issues = [];
    const valid = [];
    const map = {};
    for (const f of fields) { map[f.fieldName || f.name] = f.fieldValue || f.value; }

    if (map.Beginn && map.Ende) {
      const start = new Date(map.Beginn);
      const end = new Date(map.Ende);
      if (start >= end) {
        issues.push('Beginn muss vor dem Ende liegen');
      } else {
        const months = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
        valid.push(`Dauer: ca. ${months} Monate`);
        if (months > 36) issues.push('Elternzeit über 3 Jahre – prüfen');
      }
    }

    return { issues, valid };
  },

  businessChecks: [
    'Antrag mindestens 7 Wochen vor Beginn',
    'Geburtsurkunde liegt vor',
    'Betriebsrat informiert',
  ],

  templates: {
    hypothesis(ctx) {
      return {
        text: 'Das sieht nach einem **Elternzeit-Antrag** aus. Soll ich die Daten extrahieren und den Antrag vorbereiten?',
        suggestions: ['Ja, Antrag vorbereiten', 'Nur Daten prüfen', 'Anderer Dokumenttyp'],
      };
    },
    extractionSummary(ctx) {
      const fields = ctx.extraction?.extractedFields || [];
      const employee = ctx.employee;
      const fieldLines = fields.map(f => `- **${f.fieldName}:** ${f.fieldValue}`).join('\n');
      let empText = '';
      if (employee) empText = `\nMitarbeiter: **${employee.firstName} ${employee.lastName}** (${employee.personnelNumber})`;
      return {
        text: `Elternzeit-Antrag:\n\n${fieldLines}${empText}\n\nSoll ich den Antrag einreichen?`,
        suggestions: ['Ja, einreichen', 'Daten korrigieren', 'Abbrechen'],
      };
    },
    missingFields(list) {
      return {
        text: `Für den Elternzeit-Antrag fehlen:\n\n${list.map(m => `- ${m.prompt}`).join('\n')}`,
        suggestions: list.slice(0, 3).map(m => m.field),
      };
    },
    employeeNotFound(ctx) {
      return {
        text: 'Ich konnte keinen Mitarbeiter zuordnen. Bitte geben Sie die Personalnummer an.',
        suggestions: ['Personalnummer eingeben', 'Abbrechen'],
      };
    },
    submitted() {
      return {
        text: 'Der **Elternzeit-Antrag** wurde erfolgreich eingereicht. ✓\n\nKann ich Ihnen bei etwas anderem helfen?',
        suggestions: ['Neues Dokument hochladen', 'Frage stellen', 'Fertig'],
      };
    },
    validationFailed(issues) {
      return {
        text: `Validierungsprobleme:\n\n${issues.map(i => `- ${i}`).join('\n')}`,
        suggestions: ['Korrigieren', 'Trotzdem einreichen', 'Abbrechen'],
      };
    },
  },

  simulatedExtraction: {
    headerFields: [
      { name: 'Vorname', value: 'Max', confidence: 0.95, page: 1 },
      { name: 'Nachname', value: 'Mustermann', confidence: 0.93, page: 1 },
      { name: 'Beginn', value: '2026-07-01', confidence: 0.92, page: 1 },
      { name: 'Ende', value: '2027-06-30', confidence: 0.90, page: 1 },
    ],
    lineItems: [],
  },
};
```

### Schritt 3: In Registry registrieren

```javascript
// srv/lib/personalprodukte/registry.js
const fibu24 = require('./fibu24');
const elternzeit = require('./elternzeit');  // ← NEU

const PRODUCTS = [
  fibu24,
  elternzeit,  // ← NEU
];
```

### Schritt 4: HCM-Aktion validieren (optional)

Falls die Validierung produktspezifisch sein soll, einen neuen `case` in `hcm-service.js` → `validateAction` hinzufügen:

```javascript
case 'elternzeit':
  if (!data.beginn) { valid = false; messages.push('Beginn fehlt'); }
  if (!data.ende)   { valid = false; messages.push('Ende fehlt'); }
  break;
```

### Schritt 5: Fertig

**Das war's.** Kein Code in der Workflow-Engine, kein neues Tool, keine neue Route. Die Engine erkennt das Produkt automatisch und führt den Standard-Workflow aus.

---

## 7. Legacy-Schemas (document-schemas.js)

Fünf Schemas sind noch als Legacy-Definitionen in `document-schemas.js` hinterlegt (nicht als Produkt-Dateien):

| Schema | Status | Migration |
|--------|--------|-----------|
| Elternzeit-Antrag | Legacy | → `personalprodukte/elternzeit.js` |
| Arbeitsvertrag | Legacy | → `personalprodukte/arbeitsvertrag.js` |
| Gehaltsabrechnung | Legacy | → `personalprodukte/gehaltsabrechnung.js` |
| Krankmeldung | Legacy | → `personalprodukte/krankmeldung.js` |
| Reisekostenabrechnung | Legacy | → `personalprodukte/reisekosten.js` |

### 7.1 Adapter-Schicht

`document-schemas.js` fungiert als Adapter zwischen dem neuen Produkt-System und den Legacy-Schemas:

```
getSchema(documentType):
  1. Registry: getProduct(documentType)         → Gefunden? Return
  2. Registry: findProductByLabel(documentType)  → Gefunden? Return
  3. Legacy: DOCUMENT_WORKFLOWS[documentType]    → Gefunden? Return
  4. Return null
```

So können Legacy-Schemas und Produkt-Dateien gleichzeitig koexistieren, bis alle migriert sind.

---

## 8. Architektur-Diagramm: Produkt im Kontext

```
┌────────────────────────────────────────────────────────┐
│                   Personalprodukt                      │
│  fibu24.js / elternzeit.js / ...                      │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ triggers │  │ docai    │  │ requiredFields       │ │
│  │ (Match)  │  │ (Schema) │  │ (Pflicht-Check)      │ │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────────┘ │
│       │              │                 │               │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────────┴─────────────┐ │
│  │employee  │  │validation│  │ templates             │ │
│  │(Lookup)  │  │(X-Valid) │  │ (hypothesis, summary  │ │
│  └──────────┘  └──────────┘  │  missing, submitted)  │ │
│                              └───────────────────────┘ │
└──────────────────────────┬─────────────────────────────┘
                           │ Wird geladen von:
                           ▼
┌──────────────────────────────────────┐
│         registry.js                  │
│  matchProduct(), getProduct(), ...   │
└──────────────┬───────────────────────┘
               │ Wird aufgerufen von:
               ▼
┌──────────────────────────────────────┐
│       workflow-engine.js             │
│  executeWorkflowTurn(product, ...)   │
│  → product.templates.hypothesis()    │
│  → product.validation(fields)        │
│  → product.requiredFields            │
└──────────────────────────────────────┘
```
