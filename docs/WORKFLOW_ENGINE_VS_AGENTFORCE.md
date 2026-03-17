# Workflow-Engine vs. Agentforce: Flexibilität vs. Prozesskontrolle

> **Stand:** 17. März 2026  
> **Kontext:** HR-Agent Prototyp — Architektur-Abwägung nach Refactoring  
> **Basis:** Vergleich der aktuellen deterministischen Workflow-Engine mit dem Agentforce Topic/Instructions/Actions-Paradigma

---

## 1. Gegenüberstellung der Paradigmen

### 1.1 Agentforce: LLM-gesteuert mit deklarativen Leitplanken

Agentforce strukturiert einen Agent über **Topics**, **Instructions** und **Actions**:

```
Topic: "Fahrkostenerstattung"
  Instructions (natürliche Sprache):
    "Analysiere das Dokument, extrahiere die Felder,
     frage bei fehlenden Daten nach, validiere gegen HCM,
     reiche ein wenn der Mitarbeiter zustimmt."
     
  Actions (verfügbare Werkzeuge):
    [docai_analyze, docai_extract, hcm_lookup, hcm_submit]
    
  Guardrails:
    - Einstein Trust Layer (PII-Maskierung, Toxicity-Check)
    - Grounding durch Knowledge Base
```

**Das LLM entscheidet** über:
- Reihenfolge der Actions
- Wann welche Action aufgerufen wird
- Formulierung aller Antworten
- Wie mit unvorhergesehenen Situationen umgegangen wird
- Wechsel zwischen Topics

**Die Plattform erzwingt:**
- Nur deklarierte Actions sind aufrufbar
- Trust Layer filtert PII und toxische Inhalte
- Grounding priorisiert KB-basierte Antworten

### 1.2 HR-Agent: Deterministische State-Machine

Die aktuelle Workflow-Engine arbeitet als **fixe State-Machine**:

```
intake → awaiting_confirmation → extracting → awaiting_fields
                                                    ↓
                    awaiting_employee ← validated ← extracted
                           ↓
                    awaiting_approval → awaiting_correction
                           ↓
                         done
```

**Die Engine entscheidet** über:
- Den exakten nächsten Schritt (hardcoded `switch(state)`)
- Welche Tools in welcher Reihenfolge aufgerufen werden
- Die Antwort-Texte (feste Templates pro Produkt)

**Das LLM wird nur genutzt für:**
- Dokumentanalyse (`docai_analyze_document` im `intake`-State)
- Intent-Klassifikation (`classifyIntent()` — LLM-basiert mit Regex-Fallback)
- Freie Konversation (nur im LLM-Modus, außerhalb eines Workflows)

---

## 2. Detaillierter Vergleich

### 2.1 Ablauf-Flexibilität

| Szenario | Agentforce | Workflow-Engine |
|----------|-----------|-----------------|
| Standard-Ablauf (Upload → Analyse → Extraktion → Submit) | LLM folgt Instructions, ruft Actions in logischer Reihenfolge auf | State-Machine durchläuft `intake` → `awaiting_confirmation` → ... → `done` |
| User überspringt Bestätigung ("Ja, direkt einreichen") | LLM kann mehrere Actions in einem Turn ausführen | Nicht möglich — jeder State erfordert einen separaten Turn |
| Reihenfolge ändern ("Erst den Mitarbeiter suchen, dann extrahieren") | LLM passt Reihenfolge an | Nicht möglich — Reihenfolge ist hardcoded |
| Neuer Zwischenschritt nötig (z.B. "Zweitdokument anhängen") | LLM kann flexibel reagieren, wenn passende Action existiert | Erfordert neuen State + Code-Änderung in `workflow-engine.js` |

**Bewertung:** Agentforce ist hier klar flexibler. Die State-Machine kann nur den exakt programmierten Ablauf durchlaufen.

### 2.2 Antwort-Qualität

| Aspekt | Agentforce | Workflow-Engine |
|--------|-----------|-----------------|
| Formulierung | LLM generiert natürlich klingende, kontextbezogene Texte | Feste Templates (`product.templates.hypothesis()`, etc.) |
| Personalisierung | LLM kann auf User-Stil eingehen | Immer gleicher Text, unabhängig vom User |
| Fehlerfälle | LLM kann unvorhergesehene Situationen frei adressieren | Nur programmierte Fehlerfälle werden behandelt |
| Konsistenz | Variiert zwischen Aufrufen (Prompt-Drift möglich) | 100% reproduzierbar, jedes Mal gleicher Text |

**Bewertung:** Agentforce liefert natürlichere Interaktion. Die Templates sind dafür konsistent und auditierbar.

### 2.3 Multi-Topic & Zwischenfragen

| Szenario | Agentforce | Workflow-Engine |
|----------|-----------|-----------------|
| User fragt mitten im Fibu24-Prozess: "Wie viele Urlaubstage habe ich?" | Agent wechselt zum KB-Topic, beantwortet die Frage, kehrt zurück | Frage wird als `unclear` klassifiziert → generische Rückfrage, kein Kontextwechsel |
| User sagt: "Ach, das ist gar keine Fahrkarte, sondern eine Krankmeldung" | Agent wechselt zum Krankmeldungs-Topic | `deny` → Workflow wird abgebrochen, User muss von vorne beginnen |
| User will zwei Dokumente parallel verarbeiten | Agent kann über Kontext jonglieren | Nicht möglich — ein aktiver Workflow pro Session |

**Bewertung:** Das ist die **größte Einschränkung** der aktuellen Architektur. Agentforce kann fließend zwischen Themen wechseln, die Engine nicht.

### 2.4 Prozesskontrolle & Compliance

| Aspekt | Agentforce | Workflow-Engine |
|--------|-----------|-----------------|
| Ablauf-Garantie | LLM *soll* den Instructions folgen, *muss* aber nicht | Engine *erzwingt* den Ablauf — kein Schritt kann übersprungen werden |
| Validierung überspringen | LLM könnte bei schlechtem Prompt direkt submitten | Unmöglich — `awaiting_approval` kommt erst nach `validated` |
| Prompt Injection | Trust Layer schützt, aber LLM bleibt anfällig | Kein Risiko — Prozesslogik lebt nicht im Prompt |
| Audit-Trail | Agent-Logs + Trust Layer Logs | Deterministisch: State-Transitions sind vorhersagbar und protokollierbar |
| Reproduzierbarkeit | Gleicher Input → potenziell andere Action-Reihenfolge | Gleicher Input → garantiert gleicher Ablauf |
| Modell-Update-Robustheit | Neues GPT-Release kann Verhalten ändern | Templates und States sind modellunabhängig |

**Bewertung:** Die Workflow-Engine ist hier klar überlegen. In einem regulierten VW-Konzernumfeld mit Betriebsrat und Datenschutz ist die Garantie, dass bestimmte Schritte *immer* durchlaufen werden, ein harter Vorteil.

### 2.5 Erweiterbarkeit

| Aspekt | Agentforce | Workflow-Engine |
|--------|-----------|-----------------|
| Neuer Dokumenttyp | Topic + Instructions + Actions (deklarativ, Low-Code) | Personalprodukt-Datei (deklarativ, aber Code nötig für Templates) |
| Neuer Prozessschritt | Instructions anpassen (Text) | Neuer State im `switch(state)` + Code |
| Neue Action/Tool | Flow oder Apex Invocable Action | Tool-Definition + Executor in `agent-tools.js` |
| Test neuer Flows | Schwer (LLM-Verhalten nicht deterministisch) | Einfach (State-Transitions sind Unit-testbar) |

**Bewertung:** Agentforce ist einfacher erweiterbar bei neuen Abläufen. Die Engine ist einfacher zu testen.

---

## 3. Risiken von LLM-gesteuerter Prozesslogik

### 3.1 Halluzination im Ablauf

Das LLM könnte trotz Instructions:
- Entscheiden, dass eine Validierung "nicht nötig" ist
- Felder "ergänzen", die im Dokument nicht standen
- Einen Submit-Action aufrufen, obwohl die Daten inkonsistent sind

Einstein Trust Layer schützt vor PII-Leaks und toxischen Inhalten — aber **nicht vor falscher Prozesslogik**. Es gibt keinen "Process Guardrail" in Agentforce, der sagt: "Du darfst `hcm_submit` nicht aufrufen, bevor `hcm_validate` mit `valid: true` zurückkam."

### 3.2 Prompt-Drift

- Modell-Updates (GPT-4o → GPT-4o-2026-03) können das Verhalten ändern
- Instructions sind "best effort" — keine Garantie, dass sie befolgt werden
- A/B-Testing von Prompts ist schwer, weil das Verhalten stochastisch ist

### 3.3 Debugging-Komplexität

Wenn ein Agentforce-Agent einen Fehler macht:
- *Warum* hat das LLM diese Action gewählt? → Nur über Reasoning-Tokens nachvollziehbar
- *War es der Prompt, das Modell oder der Kontext?* → Schwer zu isolieren

Wenn die Workflow-Engine einen Fehler hat:
- State X → State Y → die `switch`-Logik ist der Code → deterministisch debuggbar

---

## 4. Lösungsansatz: "Guided Autonomy"

Ein Mittelweg, der Agentforce-Flexibilität mit Engine-Sicherheit kombiniert:

### 4.1 Konzept

```
┌─────────────────────────────────────────────────────────────────┐
│  Personalprodukt (deklarativ, wie bisher)                       │
│                                                                  │
│  id: 'fibu24'                                                    │
│  label: 'Fibu24-Nachweis'                                       │
│  triggers: ['fibu24', 'fahrkarte', ...]                          │
│                                                                  │
│  // NEU: Phasen statt fixe State-Machine                         │
│  phases: [                                                       │
│    { name: 'analyze',    required: true,  tools: ['docai_analyze'] },
│    { name: 'extract',    required: true,  tools: ['docai_extract'] },
│    { name: 'validate',   required: true,  tools: ['hcm_validate'] },
│    { name: 'submit',     required: true,  tools: ['hcm_submit']   },
│  ]                                                               │
│                                                                  │
│  // NEU: LLM-Instructions statt Templates                        │
│  instructions: `Du bearbeitest eine Fahrkostenerstattung.        │
│    Analysiere das Dokument, extrahiere die relevanten Felder,    │
│    validiere die Daten und reiche die Erstattung ein.            │
│    Frage bei fehlenden Pflichtfeldern nach.                      │
│    Informiere den Mitarbeiter über jeden Schritt.`               │
│                                                                  │
│  // NEU: Harte Gates (Engine erzwingt, LLM kann nicht umgehen)   │
│  gates: {                                                        │
│    before_submit: (data) => {                                    │
│      if (!data.validation || data.validation.issues.length > 0)  │
│        return { blocked: true, reason: 'Validierung fehlgeschlagen' };
│      if (!data.employee)                                         │
│        return { blocked: true, reason: 'Kein Mitarbeiter zugeordnet' };
│      return { blocked: false };                                  │
│    }                                                             │
│  }                                                               │
│                                                                  │
│  // NEU: Zwischenfragen erlauben                                 │
│  allowedSideTopics: ['kb_search', 'hcm_get_employee']           │
│                                                                  │
│  // Sicherheitslimits                                            │
│  maxTurns: 10                                                    │
│  maxToolCalls: 15                                                │
│                                                                  │
│  // Bestehend: Validierung, Pflichtfelder, docai-Config          │
│  requiredFields: [...]                                           │
│  validation: (fields) => { ... }                                 │
│  docai: { ... }                                                  │
│  employee: { ... }                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Wie es funktionieren würde

```
               ┌──────────────────────────────────┐
               │       Guided Autonomy Engine      │
               │                                    │
  User ──────► │  1. Welche Phase ist aktiv?        │
               │  2. Welche Tools sind erlaubt?     │
               │  3. Sind Gate-Bedingungen erfüllt? │
               │                                    │
               │         ┌──────────┐               │
               │         │   LLM    │               │
               │         │ (frei    │               │
               │         │  inner-  │               │
               │         │  halb    │               │
               │         │  der     │               │
               │         │  Phase)  │               │
               │         └──────────┘               │
               │                                    │
               │  4. Phase abgeschlossen?           │
               │  5. Nächste Phase oder Side-Topic? │
               └──────────────────────────────────┘
```

**Das LLM entscheidet:**
- Welche Tools innerhalb der aktuellen Phase aufgerufen werden
- Wie die Antwort formuliert wird (natürliche Sprache)
- Ob eine Zwischenfrage beantwortet werden kann (Side-Topic)
- Wann eine Phase "fertig" ist

**Die Engine erzwingt:**
- Alle `required: true` Phasen müssen durchlaufen werden
- `gates` sind harte Bedingungen, die das LLM nicht umgehen kann
- Nur `allowedSideTopics`-Tools dürfen außerhalb der Phasen genutzt werden
- `maxTurns` und `maxToolCalls` verhindern Endlosschleifen

### 4.3 Vergleich aller drei Ansätze auf dem Spektrum

```
Deterministisch ◄─────────────────────────────────────► Volle LLM-Autonomie

State-Machine          Guided Autonomy              Agentforce
(aktuell)              (Mittelweg)                   (Salesforce)

Engine steuert         Engine setzt Rahmen,          LLM steuert frei,
alles, LLM nur         LLM entscheidet              Instructions als
für Intent +           innerhalb der Phasen          "Empfehlung"
Analyse
```

| Eigenschaft | State-Machine | Guided Autonomy | Agentforce |
|-------------|:---:|:---:|:---:|
| Ablauf-Flexibilität | ✗ | ✓ | ✓✓ |
| Natürliche Antworten | ✗ | ✓ | ✓ |
| Multi-Topic / Zwischenfragen | ✗ | ✓ (begrenzt) | ✓✓ |
| Prozess-Garantie | ✓✓ | ✓ | ✗ |
| Validierung nicht überspringbar | ✓✓ | ✓✓ (Gates) | ✗ |
| Audit / Reproduzierbarkeit | ✓✓ | ✓ | ✗ |
| Prompt-Drift-Risiko | ✗ (kein Prompt im Flow) | ~ (Prompt für Formulierung) | ✓✓ |
| Testbarkeit | ✓✓ | ✓ | ✗ |
| Erweiterbarkeit (neuer Prozess) | ~ (Code nötig) | ✓ (deklarativ) | ✓✓ (Low-Code) |
| Erweiterbarkeit (neuer Schritt) | ✗ (Code) | ✓ (Phase hinzufügen) | ✓ (Instruction anpassen) |
| Kosten pro Gespräch | Niedrig (1-2 LLM-Calls) | Mittel (3-6 LLM-Calls) | Hoch (Salesforce-Pricing) |

---

## 5. Migrationsplan: State-Machine → Guided Autonomy

Falls die Entscheidung für "Guided Autonomy" fällt, kann schrittweise migriert werden:

### Phase 1: Templates durch LLM-generierte Antworten ersetzen (gering-invasiv)

Statt fester Templates generiert das LLM die Antwort basierend auf dem aktuellen State und den Daten:

```js
// Vorher: Template
const response = product.templates.hypothesis({ analysis: data.analysis });

// Nachher: LLM-generierte Antwort mit Kontext
const response = await generateResponse(openai, model, {
  product,
  phase: 'hypothesis',
  data: { analysis: data.analysis },
  instructions: product.instructions,
});
```

Die State-Machine bleibt bestehen, nur die Antworten werden natürlicher.

### Phase 2: Side-Topics erlauben

Vor der Intent-Klassifikation prüfen, ob die Nachricht eine Zwischenfrage ist:

```js
// Wenn der User eine Frage stellt, die nichts mit dem Workflow zu tun hat:
if (isSideTopicQuestion(msg) && product.allowedSideTopics.includes('kb_search')) {
  // KB-Suche durchführen, Antwort liefern, Workflow-State beibehalten
}
```

### Phase 3: Phasen-basierte Steuerung

Die `switch(state)`-Logik durch eine Phase-Engine ersetzen, die das LLM innerhalb von Phasen-Grenzen agieren lässt.

### Phase 4: Gates als harte Validierungen

Gate-Funktionen, die vor bestimmten Actions geprüft werden und die das LLM nicht umgehen kann. Dies ist das Gegenstück zu Agentforces fehlendem Process Guardrail.

---

## 6. Empfehlung

### Für den aktuellen PoC/Piloten

Die **deterministische State-Machine ist ausreichend und sicher**. Für den VW-Konzernkontext ist die Reproduzierbarkeit und Audit-Fähigkeit wichtiger als natürliche Antworten.

### Für die Weiterentwicklung (ab Q3 2026)

**Guided Autonomy** als Ziel-Architektur evaluieren:
- LLM-generierte Antworten statt Templates (Phase 1) sofort machbar
- Side-Topics (Phase 2) löst das größte Usability-Problem
- Phasen-Engine (Phase 3) und Gates (Phase 4) für spätere Iteration

### Agentforce nur wenn:
- Salesforce zur echten CRM-Plattform ausgebaut wird
- Einstein Trust Layer verpflichtend wird (Datenschutz-Anforderung)
- Salesforce Process Guardrails einführt (aktuell nicht vorhanden)

---

## 7. Zusammenfassung

> **Kernaussage:** Die Workflow-Engine ist aktuell rigider als Agentforce, aber diese Rigidität ist im regulierten Kontext ein Feature, kein Bug. Der Weg zu mehr Flexibilität führt über "Guided Autonomy" — nicht über die Aufgabe der Prozesskontrolle.

| | State-Machine (jetzt) | Guided Autonomy (Ziel) | Agentforce |
|---|---|---|---|
| **Wer steuert den Ablauf?** | Engine (100%) | Engine setzt Rahmen, LLM füllt aus | LLM (100%) |
| **Compliance-Eignung** | ✓✓ Sehr hoch | ✓ Hoch (Gates) | ~ Mittel |
| **User Experience** | ~ Template-Texte | ✓ Natürliche Sprache | ✓ Natürliche Sprache |
| **Aufwand neuer Prozess** | Mittel (Code) | Gering (deklarativ) | Gering (Low-Code) |
| **Risiko** | Niedrig | Niedrig-Mittel | Mittel-Hoch |
