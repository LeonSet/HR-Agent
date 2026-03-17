# AI Agent Architektur-Entscheidung: Custom BTP Agent vs. Salesforce Agentforce

> **Stand:** 17. März 2026  
> **Kontext:** HR-Agent Prototyp bei NOVENTIS (Volkswagen-Konzern)  
> **Autoren:** Leon Setkewitz + AI-gestützte Architekturanalyse

---

## 1. Ausgangslage

### 1.1 Bestehende Systemlandschaft

```
Mitarbeiter ──→ Salesforce Service Cloud ──→ Sachbearbeiter ──→ SAP HCM
  (Portal/Mail)    (Ticketing + Routing)       (manuell)

Selfservices:
Mitarbeiter ──→ SAP ESS/MSS (direkt auf HCM)
```

**Salesforce** wird im aktuellen Setup als **reiner Ticketing-Layer** verwendet:
- Ticket-Erstellung und -Routing zwischen Kunde und HCM-Team
- **Keine** Salesforce Knowledge Base (KB ist extern)
- **Keine** Salesforce Data Cloud
- **Kein** Einstein / Einstein Trust Layer im Einsatz
- **Keine** CRM-Funktionalität (kein Kundenhistorien-Datenschatz)

**SAP HCM** ist das führende System für:
- Stammdaten, Personalaktionen, Abrechnungen
- Transaktionale Selfservices (ESS/MSS)

### 1.2 Prototyp: HR-Agent auf BTP

Der aktuelle Prototyp implementiert einen AI Agent auf SAP BTP:

```
┌─────────────────────────────────────────────┐
│  AI Agent (SAP BTP / CAP Node.js)           │
│  ┌────────────────────────────────────────┐ │
│  │ Agent Loop (OpenAI GPT-4o-mini)        │ │
│  │ Case Layer (Audit / Orchestrierung)    │ │
│  └──┬───┬───┬───┬───┬───────────────────┘ │
└─────┼───┼───┼───┼───┼──────────────────────┘
      ↓   ↓   ↓   ↓   ↓
    HCM DocAI KB  BPA  Salesforce
   (SAP) (VW) (Ext)(BTP)(Ticket-Eskalation)
```

**Tools des Agents:**
| Tool | Zweck | Backend |
|------|-------|---------|
| `kb_search` | HR-Wissensbasis durchsuchen | Eigene Knowledge Base |
| `hcm_get_employee` | Mitarbeiterdaten abrufen | SAP HCM (simuliert) |
| `hcm_validate_action` | HR-Aktion validieren | SAP HCM Regelwerk |
| `hcm_submit_action` | HR-Aktion einreichen | SAP HCM (simuliert) |
| `docai_analyze_document` | Dokument per KI analysieren | OpenAI Vision + pdf-parse |
| `docai_start_extraction` | Schema-gebundene Extraktion | vw-doc-ai (Mistral OCR) |
| `docai_get_extraction` | Extraktionsergebnis + Validation | vw-doc-ai + Cross-Validation |
| *(geplant)* `bpa_start_process` | BTP Process Automation starten | SAP Build Process Automation |
| *(geplant)* `ticket_create` | Eskalations-Ticket erstellen | Salesforce / Ticketsystem |

---

## 2. Architekturoptionen

### Option A: Agent IN Salesforce (Agentforce)

```
┌─────────────────────────────────────────┐
│  Salesforce                             │
│  ┌───────────────┐  ┌───────────────┐   │
│  │ Agentforce    │  │ Service Cloud  │   │
│  │ (AI Agent)    │→ │ (Cases, SLA)   │   │
│  └───────┬───────┘  └───────┬───────┘   │
│     Custom Actions     Bestehende       │
│     (Apex/Flow)        Prozesse         │
└──────────┼──────────────────┼───────────┘
           ↓                  ↓
      ┌────────┐         ┌────────┐
      │vw-doc-ai│         │SAP HCM │
      └────────┘         └────────┘
```

### Option B: Agent AUF BTP, Salesforce als Tool

```
┌──────────────────┐
│  Agent (BTP)     │
│  ┌────────────┐  │
│  │ Agent Loop  │  │
│  └──┬──┬──┬───┘  │
└─────┼──┼──┼──────┘
      ↓  ↓  ↓
   HCM DocAI Salesforce
                (Eskalation)
```

---

## 3. Bewertung: Agentforce vs. Custom Agent

### 3.1 Wann Agentforce die bessere Wahl wäre

Agentforce ist optimal wenn:
- Salesforce **bereits als CRM** genutzt wird (nicht nur Ticketing)
- **Salesforce Knowledge Base** die primäre Wissensquelle ist
- **Einstein Trust Layer** für PII-Schutz benötigt wird
- Sachbearbeiter **ausschließlich in Salesforce** arbeiten
- Standard-HR-Prozesse über **Salesforce Cases** abgebildet werden
- Die Organisation schneller live gehen will (weniger Custom Code)
- **Salesforce Data Cloud** Kundendaten aggregiert

### 3.2 Warum Agentforce im aktuellen Kontext NICHT optimal ist

#### Fehlende Salesforce-Substanz
- **Kein Knowledge:** Agentforce braucht Datenquellen zum Suchen — die KB ist extern
- **Kein CRM-Datenschatz:** Keine Kundenhistorie, keine kontextreichen Cases — nur Ticket-Nummern
- **Kein Einstein Trust Layer nötig:** Kein PII in Salesforce das geschützt werden müsste
- **Kein Einstein Search:** Keine semantische Suche über Salesforce-Daten verfügbar

#### Integrationskomplexität
Agentforce müsste über Custom Actions (Apex/Flow) auf alle externen Systeme zugreifen:

```
Agentforce ←→ SAP HCM     → Custom Connector nötig (Named Credentials + Apex)
Agentforce ←→ vw-doc-ai   → Custom Connector nötig (OAuth2 M2M + Apex)
Agentforce ←→ BTP BPA     → Custom Connector nötig
Agentforce ←→ Externe KB  → Custom Connector nötig
```

**Ergebnis:** Man baut vier Salesforce-Connectoren, um am Ende genau dasselbe aufzurufen, was der BTP-Agent direkt tut — mit einer zusätzlichen Plattform dazwischen.

#### Kosten
| | Custom Agent (BTP) | Agentforce |
|---|---|---|
| Pro Gespräch | ~0,05 $ (OpenAI Tokens) | ~2,00 $ (Salesforce Pricing) |
| Plattform | BTP (ohnehin vorhanden) | Salesforce Agentforce Lizenz |
| Entwicklung | Node.js / CAP | Apex / Flow + Prompt Builder |
| Modellwahl | Frei (OpenAI, Anthropic, Mistral, ...) | Einstein GPT (eingeschränkt) |

#### Vendor Lock-in
- Agentforce bindet tiefer an Salesforce, obwohl der **technische Kern im SAP-Ökosystem** liegt
- Strategisch kontraproduktiv: Salesforce-Abhängigkeit steigt, obwohl das Ziel ist, Ticketaufkommen zu senken

### 3.3 Vorteile des Custom BTP Agent

| Kriterium | Bewertung |
|-----------|-----------|
| **SAP-nativer Zugriff** | Direkt auf HCM, BTP BPA — kein Connector nötig |
| **vw-doc-ai Integration** | Gleicher BTP-Stack, gleicher OAuth2-Kontext |
| **Modellfreiheit** | GPT-4o-mini heute, morgen Mistral, Anthropic oder SAP GenAI Hub |
| **Prompt Engineering** | Volle Kontrolle über System-Prompts, Tool-Definitionen, Multi-Step |
| **Kosten** | 40x günstiger pro Gespräch |
| **Datensouveränität** | Daten bleiben im VW/SAP-Ökosystem (BTP, keine Salesforce-Cloud) |
| **Strategische Ausrichtung** | Stärkt SAP-Investition, reduziert Salesforce-Abhängigkeit |

---

## 4. Hybrid-Architektur: Dokumentenverarbeitung

### Warum nicht einfach alles mit dem LLM extrahieren?

Es gibt zwei grundsätzliche Ansätze für Dokumentenextraktion:

#### Ansatz 1: Agent macht alles direkt (LLM-only)
```
User → Agent (GPT-4o) → Vision API / pdf-parse → JSON im Prompt → Case Layer
```

**Pro:** Einfacher, flexibler (neuer Dokumenttyp = neuer Prompt), schneller für Prototypen  
**Contra:**
- Nicht reproduzierbar (Prompt-Änderung → andere Felder/Formate)
- Kein Review-Workflow (Agent sagt "passt" → fertig)
- Halluzinationsrisiko (LLM erfindet Werte bei schlechter Scan-Qualität)
- Keine Schema-Governance (implizite Schema-Definition im Prompt, nicht versioniert)
- Audit-Lücke ("GPT-4o hat am 16.03. mit Temperature 0.1 diesen Wert extrahiert" — schwer nachprüfbar)

#### Ansatz 2: Externe Doc-AI (vw-doc-ai) mit Schema
```
User → Agent → First Look (GPT-4o-mini) → vw-doc-ai (Mistral OCR + Schema) → Case Layer
```

**Pro:**
- Reproduzierbar (gleiche Schema-Definition → gleiche Felder)
- Revisionssicher (eigener Audit-Trail: PENDING → PROCESSING → DONE, APPROVE/REJECT)
- Schema-getrieben (deterministisch definierte Felder)
- Spezialisierte OCR (Mistral OCR besser bei schlechten Scans als GPT-Vision)
- Entkoppelt (skaliert unabhängig, andere Apps nutzen dieselben Schemas)

#### Gewählter Ansatz: Hybrid (Best of Both)

```
Phase 1 (First Look):  Agent → GPT-4o-mini Vision → schnelle Klassifikation
Phase 2 (Extraktion):  Agent → vw-doc-ai + Schema → reproduzierbare Felder
Phase 3 (Validierung): Agent → Cross-Validation + HCM-Prüfung → Ergebnis
```

**Separation of Concerns:** Der Agent orchestriert und entscheidet, die Doc-AI extrahiert deterministisch, der Case Layer protokolliert alles.

Für einen **VW-Konzern-Kontext** mit Betriebsrat, Datenschutz und Revisionspflicht ist die externe Doc-AI der richtige Weg.

---

## 5. Case Layer vs. Ticketsystem

### Sind sie nicht redundant?

**Nein — sie sind komplementär:**

| | Case Layer (Agent-intern) | Ticketsystem (Salesforce) |
|---|---|---|
| **Zweck** | Orchestrierung innerhalb einer Agent-Session | Langlebige Vorgänge, SLA, Zuweisung |
| **Lebensdauer** | Minuten (Upload → Extraktion → HCM) | Tage/Wochen |
| **Audience** | Agent + Audit | Sachbearbeiter, Teamleiter |
| **Granularität** | 20+ Events pro Session | 1 Ticket |
| **Funktion** | Transaktionslog | Prozesssteuerung |

```
Agent-Session (Case Layer)          Ticketsystem
┌─────────────────────────┐         ┌──────────────────┐
│ Upload → Analyse →      │────────→│ Ticket #4711     │
│ Extraktion → Validation │  Daten  │ Typ: Fibu24      │
│ → HCM-Aktion           │  fließen│ Status: Offen     │
│                         │         │ Kontext: alles    │
│ [20 Audit Events]       │         │ was der Agent tat │
└─────────────────────────┘         └──────────────────┘
```

Der Case Layer ist das **Agent-Gedächtnis** innerhalb einer Session. Das Ticket entsteht wenn:
- Der Agent fertig ist und das Ergebnis übergeben will
- Der Agent nicht weiterkommt und eskalieren muss
- Ein Mensch den Vorgang prüfen/genehmigen soll

---

## 6. Strategische Empfehlung

### Positionierung von Salesforce

Salesforce wird zum **Eskalationskanal** — ein Tool unter vielen:

```
        ┌─────────────────────────────────────┐
        │         AI Agent (BTP)              │
        │  Orchestrierung + Case Layer        │
        ├──────┬──────┬──────┬──────┬────────┤
        │ HCM  │DocAI │ BPA  │ KB   │Ticket  │
        │(SAP) │(VW)  │(BTP) │(Eigen)│(SF)   │
        └──────┴──────┴──────┴──────┴────────┘
```

Der Agent löst **~80% der Anfragen selbst**. Die restlichen **~20%** gehen als Ticket mit vollem Kontext an Salesforce.

### Roadmap

| Phase | Zeitraum | Fokus |
|-------|----------|-------|
| **PoC** | Jetzt | BTP Agent weiterentwickeln: BPA-Tools, Ticket-Eskalation, weitere Workflows |
| **Pilot** | Q2 2026 | Pilotgruppe mit echtem HCM-Anbindung, Messung Ticket-Reduktion |
| **Evaluierung** | Q3 2026 | A/B-Test Custom vs. Agentforce (falls SF-Substanz wächst), Kostenvergleich |
| **Produktiv** | Q4 2026 | Agent dort wo der größte Impact ist — voraussichtlich BTP |

### Entscheidungskriterium für Neubewertung

Die Entscheidung sollte **neu bewertet** werden, wenn:
- Salesforce zur **echten CRM-Plattform** ausgebaut wird (Data Cloud, Knowledge, Einstein)
- Die Organisation **strategisch auf Salesforce setzt** (nicht nur Ticketing)
- Agentforce **signifikant günstiger** wird oder SAP GenAI Hub sich als unzureichend erweist

Solange Salesforce ein dünner Routing-Layer bleibt, ist der Custom BTP Agent die richtige Wahl.

---

## 7. Zusammenfassung

> **Kernaussage:** Den AI Agent dort bauen, wo die Daten und Systeme sind — nicht dort, wo das Ticketsystem steht.

- SAP HCM ist das führende System → Agent gehört ins SAP/BTP-Ökosystem
- vw-doc-ai ist ein BTP-Service → direkte Integration ohne Umweg
- Salesforce ist ein Ticketing-Tool → wird zum Eskalationskanal (ein Tool unter vielen)
- Der Agent **senkt** das Ticketaufkommen statt es zu **verwalten**
- Hybrid-Dokumentenverarbeitung (LLM First Look + Schema-OCR) bietet Flexibilität und Compliance
- Case Layer und Ticketsystem sind komplementär, nicht redundant
