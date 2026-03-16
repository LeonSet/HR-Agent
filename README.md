# HR-Agent — Prototyp

HR-Agent auf SAP BTP: CAP Backend + React Frontend als Prototyp für einen HR-Chatbot, der Personalprozesse auf dem SAP HCM durchführt.

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  React Frontend (app/)           Vite + TypeScript          │
│  ├── Chatbot UI (Glassmorphism Design)                      │
│  ├── Dokument-Upload (Drag & Drop)                          │
│  └── Extraktions-Ergebnis-Anzeige                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ /api/*
┌──────────────────────▼──────────────────────────────────────┐
│  CAP Backend (srv/)              Node.js + SQLite/HANA      │
│  ├── ChatService    (/api/chat)     Konversation            │
│  ├── DocumentService(/api/documents) vw-doc-ai Integration  │
│  └── HCMService     (/api/hcm)      SAP HCM (simuliert)    │
└──────────┬───────────────────────┬──────────────────────────┘
           │                       │
    ┌──────▼───────┐       ┌───────▼──────────┐
    │  vw-doc-ai   │       │  SAP HCM         │
    │  (SAP BTP)   │       │  (simuliert →     │
    │  Dokument-   │       │   später echt)    │
    │  extraktion  │       │                   │
    └──────────────┘       └──────────────────┘
```

## Quick Start

```bash
# Backend-Abhängigkeiten installieren
npm install

# Frontend-Abhängigkeiten installieren
npm run install:app

# CAP Backend starten (Port 4004)
npm run dev

# React Frontend starten (Port 5173, Proxy → 4004)
npm run dev:app
```

## vw-doc-ai Integration

Für die echte Dokumentenverarbeitung via vw-doc-ai folgende Umgebungsvariablen setzen:

```bash
export VW_DOCAI_URL=https://vw-doc-ai-srv.cfapps.eu10-004.hana.ondemand.com
export VW_DOCAI_XSUAA_URL=https://vw-ag-hr-digital-services-dev.authentication.eu10.hana.ondemand.com
export VW_DOCAI_CLIENT_ID=sb-vw-doc-ai!t551846
export VW_DOCAI_CLIENT_SECRET=<geheim>
export VW_DOCAI_CLIENT_APP_ID=hr-agent
```

Ohne diese Variablen läuft der Service im **Simulationsmodus** mit realistischen Testdaten.

## Projektstruktur

```
├── db/                     CDS Datenmodell
│   ├── schema.cds          Entitäten (Chat, Dokumente, HCM)
│   └── data/               Testdaten (Mitarbeiter)
├── srv/                    CAP Services
│   ├── services.cds        Service-Definitionen
│   ├── chat-service.js     Chat (Prototyp: regelbasiert → LLM)
│   ├── document-service.js Dokumenten-Upload + vw-doc-ai
│   ├── hcm-service.js      Simuliertes SAP HCM
│   └── lib/
│       └── vw-doc-ai-client.js  M2M-Client (OAuth2 + API)
├── app/                    React Frontend
│   ├── src/
│   │   ├── components/     Navbar, Topbar, ChatWindow, FloatingTags
│   │   ├── styles/         CSS (Glassmorphism Design)
│   │   └── api.ts          API-Client für CAP Backend
│   └── vite.config.ts      Dev-Proxy auf CAP
└── package.json            CAP Root
```

## Iterativer Ausbauplan

1. **Phase 1 (aktuell):** Prototyp mit simulierten Antworten + vw-doc-ai Anbindung
2. **Phase 2:** LLM-Integration für intelligente Konversation
3. **Phase 3:** Echte SAP HCM Anbindung (SF API / BAPI)
4. **Phase 4:** Vollständiger HR-Agent mit End-to-End Personalprozessen-demo