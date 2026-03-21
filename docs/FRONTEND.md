# Frontend – React-App

> **Verzeichnis:** `app/`  
> **Port:** 5173 (Vite Dev-Server, Proxy → Backend 4004)  
> **Stack:** React 19, TypeScript 5.8, Vite 6.3, react-markdown 10  
> **Verwandte Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [API_REFERENCE.md](API_REFERENCE.md)

---

## 1. Übersicht

Die App ist ein Chat-Interface, das das SAP-Fiori-ähnliche **VOLKSWAGEN PERSONAL PORTAL** nachbildet. Alle Backend-Kommunikation läuft über einen Vite-Proxy (`/api → localhost:4004`).

### Verzeichnisstruktur

```
app/
├── index.html              # HTML-Shell (lang="de", Font Awesome 6.5, Inter-Font, HR-Logo)
├── package.json            # hr-agent-app: react 19, vite 6.3, react-markdown 10
├── tsconfig.json           # ES2020, strict, react-jsx, noUnusedLocals/Params
├── vite.config.ts          # Port 5173, Proxy /api→4004, outDir: dist
├── public/
│   └── HR_logo.png         # Favicon
└── src/
    ├── main.tsx            # StrictMode → <App />
    ├── App.tsx             # Layout-Root: Navbar + Topbar + ChatWindow + FloatingTags
    ├── api.ts              # API-Client (alle Backend-Aufrufe)
    ├── vite-env.d.ts       # Vite-Typen
    ├── components/
    │   ├── ChatWindow.tsx  # Hauptkomponente (~300 Zeilen)
    │   ├── Navbar.tsx      # Top-Navigation (VW-Branding)
    │   ├── Topbar.tsx      # Sub-Navigation (6 Kategorien)
    │   └── FloatingTags.tsx # Seitenleiste (4 Tags)
    └── styles/
        ├── global.css      # CSS-Variablen, Reset, Grundlayout (93 Zeilen)
        ├── ChatWindow.css  # Chat-UI, Markdown, Tool-Calls (624 Zeilen)
        ├── Navbar.css      # VW-Navbar-Styling (99 Zeilen)
        ├── Topbar.css      # Sub-Navigation-Styling (87 Zeilen)
        └── FloatingTags.css # Floating-Tags-Styling (119 Zeilen)
```

---

## 2. Konfiguration

### 2.1 Vite (`vite.config.ts`)

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
});
```

- **Proxy:** Alle `/api/*`-Requests → CAP-Server auf Port 4004
- **Build-Output:** `app/dist/` (für Produktion: `npm run build` im `app/`-Verzeichnis)

### 2.2 TypeScript (`tsconfig.json`)

| Option | Wert | Bedeutung |
|--------|------|-----------|
| `target` | ES2020 | Browser-Kompatibilität |
| `strict` | true | Strikte Typprüfung |
| `jsx` | react-jsx | Automatischer JSX-Transform |
| `noUnusedLocals` | true | Keine ungenutzten Variablen |
| `noUnusedParameters` | true | Keine ungenutzten Parameter |
| `noFallthroughCasesInSwitch` | true | Switch-Cases brauchen break |

### 2.3 Dependencies

| Paket | Version | Zweck |
|-------|---------|-------|
| `react` | ^19.0.0 | UI-Framework |
| `react-dom` | ^19.0.0 | DOM-Rendering |
| `react-markdown` | ^10.1.0 | Markdown-Rendering für LLM-Antworten |
| `@vitejs/plugin-react` | ^4.4.0 | Vite React-Plugin (HMR, JSX) |
| `typescript` | ~5.8.3 | TypeScript-Compiler |
| `vite` | ^6.3.5 | Bundler & Dev-Server |

### 2.4 Externe Ressourcen (CDN)

- **Font Awesome 6.5** – Icons für Navigation und UI-Elemente
- **Google Fonts: Inter** – Schriftart (300, 400, 500, 600)
- **SAP Icon Font** – Icons aus dem SAP Fiori-Design-System (Unicode-Referenzen in `ChatWindow.tsx`)

---

## 3. Komponentenarchitektur

```
App
 ├── Navbar           (VW-Branding, Navigations-Icons)
 ├── Topbar           (6 Portal-Kategorien)
 ├── ChatWindow       (Haupt-Chat-Interface)
 │    ├── Message[]   (User/Bot-Nachrichten mit Markdown)
 │    │    ├── ToolCallsDisplay   (Expandierbare Tool-Call-Ansicht)
 │    │    └── ExtractionResult   (Extrahierte Felder mit Confidence)
 │    ├── Suggestions (Klickbare Vorschläge)
 │    ├── UploadArea  (Drag & Drop Overlay)
 │    └── InputFooter (Textarea + Upload-Button + Send)
 └── FloatingTags     (4 Seitenleisten-Tags)
```

---

## 4. Komponentenreferenz

### 4.1 `App.tsx`

**Layout-Root.** Rendert alle 4 Top-Level-Komponenten. Verwaltet `sidebarOpen`-State (derzeit nicht aktiv genutzt, an FloatingTags übergegeben).

```tsx
export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <>
      <Navbar />
      <Topbar />
      <ChatWindow />
      <FloatingTags sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
    </>
  );
}
```

---

### 4.2 `Navbar.tsx`

**Volkswagen-Portal-Navigation.** Rein visuell, keine Logik.

| Element | Beschreibung |
|---------|-------------|
| Brand-Bereich | "VOLKSWAGEN" + "PERSONAL PORTAL" |
| Desktop-Icons | Suche, Verlauf, Sichern, Hilfe, Benachrichtigungen, Benutzer, Mehr |
| Mobile-Icons | Benutzer-Kreis ("LS") + Mehr |

Nutzt Font Awesome Icons. Responsive: Desktop vs. Mobile Layout über CSS.

---

### 4.3 `Topbar.tsx`

**Sub-Navigation** mit 6 Kategorien:

1. ME@NOVENTIS
2. MEINE MITARBEITER
3. MEIN BETREUUNGSBEREICH
4. HR PROZESSE
5. HR PRODUKTKATALOG
6. WISSEN A - Z

Links & Rechts: Chevron-Buttons für horizontales Scrolling. Alle Links sind Platzhalter (`href="#"`).

---

### 4.4 `ChatWindow.tsx` (Hauptkomponente)

**~300 Zeilen.** Enthält die gesamte Chat-Logik und -UI.

#### State

| State | Typ | Default | Beschreibung |
|-------|-----|---------|-------------|
| `messages` | `ChatMessage[]` | Willkommensnachricht | Alle Chat-Nachrichten |
| `input` | `string` | `''` | Aktueller Textarea-Inhalt |
| `isLoading` | `boolean` | `false` | Wartet auf Backend-Antwort |
| `sessionId` | `string \| null` | `null` | Session-ID (wird vom Backend gesetzt) |
| `suggestions` | `string[]` | 3 Default-Suggestions | Aktuelle Vorschläge |
| `isDragging` | `boolean` | `false` | Drag & Drop Overlay aktiv |

#### Interfaces

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  extractedData?: ExtractedField[];   // Extrahierte Dokumentfelder
  toolCalls?: ToolCallInfo[];          // Tool-Call-Infos
  attachment?: string;                 // Dateiname bei Upload
}
```

#### Kernfunktionen

**`handleSend(text?: string)`**
1. Nimmt `text` oder `input`-State
2. Fügt User-Nachricht zu `messages` hinzu
3. Ruft `sendMessage(sessionId, msg)` auf
4. Setzt `sessionId` aus Response
5. Fügt Assistant-Nachricht mit `toolCalls` hinzu
6. Aktualisiert `suggestions`

**`handleFileUpload(file: File)`**
1. Zeigt User-Nachricht "Dokument hochgeladen: {filename}"
2. Ruft `uploadDocument(file, sessionId)` auf → Phase 1 Intake
3. Konstruiert Agent-Nachricht mit `documentId` + `caseId`
4. Ruft `sendMessage()` mit dieser Agent-Nachricht auf → Agent analysiert das Dokument
5. Zeigt Agent-Antwort mit Tool-Calls

**Datei-Upload Wege:**
- **Drag & Drop:** `onDragOver` / `onDragLeave` / `onDrop` Events auf `.chatbot-card`
- **Button:** Hidden `<input type="file">`, getriggert über Attachment-Icon
- **Akzeptierte Formate:** `.pdf, .png, .jpg, .jpeg, .tiff`

**Keyboard-Shortcuts:**
- `Enter` → Senden
- `Shift+Enter` → Neue Zeile

#### Auto-Behaviors

- **Auto-Scroll:** `useEffect` scrollt zu `scrollHeight` bei jeder Nachrichten-Änderung
- **Auto-Resize Textarea:** Wächst mit Inhalt, maximal 30% der Viewport-Höhe

#### ToolCallsDisplay (Sub-Komponente)

Rendert Tool-Calls im "Copilot-Style":

```
┌──────────────────────────────────────────┐
│ ⚡ 3 Aktionen ausgeführt  🔍 👤 📋  › │  ← Zusammenfassung (klickbar)
├──────────────────────────────────────────┤
│  🔍 Wissensbasis durchsucht          ›  │  ← Einzelner Tool-Call (klickbar)
│  ├── Parameter                          │
│  │   { "query": "Elternzeit" }          │
│  └── Ergebnis                           │
│      { "found": 3, "chunks": [...] }    │
├──────────────────────────────────────────┤
│  👤 Mitarbeiterdaten abgerufen       ›  │
│  📋 HR-Aktion validiert              ›  │
└──────────────────────────────────────────┘
```

- **TOOL_META:** Mapping von Tool-Name → Icon + deutsches Label für alle 13 Tools
- **Expandierbar:** Klick auf Summary öffnet Liste, Klick auf Tool öffnet Details (Parameter + Ergebnis als formatiertes JSON)

#### SAP_ICONS Mapping

Unicode-Referenzen für SAP-Fiori-Icons, genutzt in der Chat-UI:

| Key | Unicode | Verwendung |
|-----|---------|-----------|
| `attachment` | `\ue04a` | Upload-Button, Datei-Nachrichten |
| `step` | `\ue0fe` | Tool-Call Aktionen |
| `inspection` | `\ue06e` | Dokumentanalyse |
| `search` | `\ue00d` | KB-Suche |
| `employee` | `\ue036` | Mitarbeiterdaten |
| `accept` | `\ue280` | Validierung |
| `alert` | `\ue053` | Fehlermeldungen |

#### Confidence-Badge Klassen

| Confidence | Klasse | Farbe |
|-----------|--------|-------|
| ≥ 0.90 | `high` | Grün |
| ≥ 0.70 | `medium` | Gelb |
| < 0.70 | `low` | Rot |

---

### 4.5 `FloatingTags.tsx`

**Floating-Seitenleiste** mit 4 kontextuellen Tags:

| Tag | Icon |
|-----|------|
| Kontaktformular | `fas fa-envelope` |
| Regelungen | `fa-solid fa-section` |
| HR Produkte | `fas fa-boxes` |
| Systeme | `fa-solid fa-circle-nodes` |

Nimmt `sidebarOpen` und `onToggle` Props, nutzt diese aber derzeit nicht aktiv (Parameter mit `_` prefixed).

---

## 5. API-Client (`api.ts`)

### 5.1 Interfaces

```typescript
interface ToolCallInfo {
  tool: string;       // Tool-Name (z.B. "kb_search")
  args: string;       // JSON-String der Parameter
  result: string;     // JSON-String des Ergebnisses
}

interface SendMessageResponse {
  reply: string;           // LLM-Antwort
  sessionId: string;       // Session-UUID
  suggestions: string[];   // Vorschläge für nächsten Schritt
  toolCalls?: ToolCallInfo[]; // Ausgeführte Tool-Calls
}

interface UploadResponse {
  documentId: string;  // Dokument-UUID
  caseId: string;      // Case-UUID
  status: string;      // 'uploaded'
  phase: string;       // 'intake'
}

interface PollResponse {
  status: string;
  extractedData: ExtractedField[];
  validation?: {
    documentType: string;
    isValid: boolean;
    issues: string[];
    validChecks: string[];
    fieldCount: number;
    businessChecks?: string[];
  };
}

interface ExtractedField {
  fieldName: string;
  fieldValue: string;
  confidence: number;
  rawValue: string;
  page: number;
}
```

### 5.2 Funktionen

| Funktion | Endpoint | Methode | Body | Return |
|----------|----------|---------|------|--------|
| `sendMessage` | `/api/chat/sendMessage` | POST | `{ sessionId, message }` | `SendMessageResponse` |
| `uploadDocument` | `/api/documents/upload` | POST | `FormData (file, sessionId?)` | `UploadResponse` |
| `pollDocumentStatus` | `/api/documents/pollJobStatus` | POST | `{ documentId }` | `PollResponse` |
| `getEmployeeData` | `/api/hcm/getEmployeeData` | POST | `{ personnelNumber }` | Employee-Objekt |
| `validateHCMAction` | `/api/hcm/validateAction` | POST | `{ actionType, payload }` | Validierungsergebnis |
| `submitHCMAction` | `/api/hcm/submitAction` | POST | `{ actionType, employeeId, payload }` | Action-Ergebnis |

**Hinweis:** `payload` wird bei HCM-Funktionen als `JSON.stringify(payload)` übergeben (String im String).

**Basis-URL:** `const API_BASE = '/api'` — alle Requests gehen über den Vite-Proxy.

**Fehlerbehandlung:** Alle Funktionen werfen `Error` bei `!res.ok` mit Status-Code.

---

## 6. Styling-Architektur

### 6.1 CSS-Dateien (1.022 Zeilen gesamt)

| Datei | Zeilen | Zweck |
|-------|--------|-------|
| `global.css` | 93 | CSS-Variablen, Reset, Body-Layout, Icon-Font |
| `ChatWindow.css` | 624 | Chat-Container, Nachrichten, Markdown, Tool-Calls, Suggestions, Upload-Overlay, Typing-Indicator |
| `FloatingTags.css` | 119 | Floating-Tag-Container, Hover-Animationen |
| `Navbar.css` | 99 | VW-Branding, Desktop/Mobile-Layout |
| `Topbar.css` | 87 | Sub-Navigation, Scroll-Buttons |

### 6.2 Design-System

- **Schriftart:** Inter (Google Fonts, Gewichte: 300–600)
- **Icons:** Mix aus Font Awesome 6.5 (Navigation) und SAP Icon Font (Chat-UI)
- **Responsive:** CSS Media Queries für Mobile-/Desktop-Layout
- **Glassmorphism:** Suggestions-Bereich mit Glaseffekt-Overlay über dem Input

---

## 7. Datenfluss

### 7.1 Chat-Nachricht senden

```
User tippt         →  handleSend()
                   →  setMessages([...prev, userMsg])
                   →  sendMessage(sessionId, msg)
                        ↓
              Vite Proxy /api/chat/sendMessage
                        ↓
              CAP Server (chat-service.js)
                        ↓
              Agent Loop → Tool Calls → LLM
                        ↓
              Response { reply, sessionId, suggestions, toolCalls }
                        ↓
                   →  setSessionId(res.sessionId)
                   →  setMessages([...prev, assistantMsg])
                   →  setSuggestions(res.suggestions)
```

### 7.2 Dokument hochladen

```
User wählt Datei   →  handleFileUpload(file)
                   →  uploadDocument(file, sessionId)
                        ↓
              POST /api/documents/upload (Express+Multer)
                        ↓
              server.js → SHA-256 Hash, Case INSERT, Document INSERT
                        ↓
              Response { documentId, caseId, status: 'uploaded', phase: 'intake' }
                        ↓
                   →  sendMessage(sessionId, „Ein Dokument wurde hochgeladen...")
                        ↓
              Agent analysiert via docai_analyze_document
                        ↓
              Response mit Analyse + Vorschlägen
```

### 7.3 Suggestion-Klick

```
User klickt Chip   →  handleSend(suggestionText)
                   →  (identisch wie manuelle Eingabe)
```

---

## 8. Entwicklung

### 8.1 Befehle

```bash
cd app
npm install           # Dependencies installieren
npm run dev           # Vite Dev-Server (Port 5173)
npm run build         # TypeScript + Vite Build → dist/
npm run preview       # Produktions-Preview
```

### 8.2 Vom Backend aus starten

```bash
# Im Root-Verzeichnis:
npm run build:app     # = cd app && npm install && npm run build
npm run dev           # = cds watch (serviert auch app/dist/ als Fiori-App)
```

### 8.3 Voraussetzungen

- Backend muss auf Port 4004 laufen (`npm run dev` im Root)
- Vite-Proxy leitet `/api/*` automatisch weiter
- Kein separater CORS-Setup nötig
