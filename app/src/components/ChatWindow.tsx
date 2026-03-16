import { useState, useRef, useEffect, useCallback, type DragEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { sendMessage, uploadDocument, type ExtractedField, type ToolCallInfo } from '../api';
import '../styles/ChatWindow.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  extractedData?: ExtractedField[];
  toolCalls?: ToolCallInfo[];
  attachment?: string;  // Dateiname bei Upload-Nachrichten
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hallo! Willkommen im HR Beratungscenter. Ich bin Ihr HR-Agent und unterstütze Sie bei Personalthemen – von Elternzeit über Teilzeit bis zur Dokumentenverarbeitung. Wie kann ich Ihnen helfen?' },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(['Elternzeit beantragen', 'Teilzeit beantragen', 'Dokument hochladen']);
  const [isDragging, setIsDragging] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = window.innerHeight * 0.3;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ─── Send Message ─────────────────────────────────────
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsLoading(true);
    setSuggestions([]);

    try {
      const res = await sendMessage(sessionId, msg);
      setSessionId(res.sessionId);
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply, toolCalls: res.toolCalls }]);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: `${SAP_ICONS.alert} Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.` }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId]);

  // ─── File Upload: Direkt als Intake hochladen, Agent analysiert ──
  const handleFileUpload = useCallback(async (file: File) => {
    setMessages(prev => [...prev, { role: 'user', content: `Dokument hochgeladen: ${file.name}`, attachment: file.name }]);
    setIsLoading(true);

    try {
      const uploadRes = await uploadDocument(file, sessionId || undefined);

      // Agent per Chat-Nachricht informieren – er ruft docai_analyze_document auf
      const agentMessage =
        `Ein Dokument wurde hochgeladen (documentId: "${uploadRes.documentId}", ` +
        `caseId: "${uploadRes.caseId}", Datei: "${file.name}"). ` +
        `Bitte analysiere das Dokument.`;

      const res = await sendMessage(sessionId, agentMessage);
      setSessionId(res.sessionId);
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply, toolCalls: res.toolCalls }]);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `${SAP_ICONS.alert} Fehler beim Upload von "${file.name}".`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // ─── Drag & Drop ──────────────────────────────────────
  const onDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  // ─── Key Handler ──────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section className="chat-container">
      <div className="chatbot-card" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <header className="chatbot-header">
          <h1>HR Beratungscenter</h1>
        </header>

        <div className="chatbot-body" ref={bodyRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`message-group ${msg.role === 'user' ? 'message-group-user' : 'message-group-bot'}`}>
              {/* Tool-Calls Copilot-Style */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallsDisplay toolCalls={msg.toolCalls} />
              )}
              <div className={`message ${msg.role === 'user' ? 'user' : 'bot'}${msg.attachment ? ' has-attachment' : ''}`}>
                {msg.attachment && (
                  <span className="sap-icon message-attachment-icon">{SAP_ICONS.attachment} </span>
                )}
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              {msg.extractedData && (
                <div className="extraction-result">
                  <h4><span className="sap-icon">{SAP_ICONS.inspection}</span> Extrahierte Daten</h4>
                  {msg.extractedData.map((field, j) => (
                    <div className="extraction-field" key={j}>
                      <span className="field-name">{field.fieldName}</span>
                      <span>
                        <span className="field-value">{field.fieldValue}</span>
                        <span className={`confidence-badge ${getConfidenceClass(field.confidence)}`}>
                          {Math.round(field.confidence * 100)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="message-group message-group-bot">
              <div className="typing-indicator">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            </div>
          )}

        </div>

        {/* Suggestions – glassmorphism overlay above input */}
        {suggestions.length > 0 && !isLoading && (
          <div className="suggestions">
            {suggestions.map(s => (
              <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>{s}</button>
            ))}
          </div>
        )}

        {/* Drag overlay */}
        {isDragging && (
          <div className="upload-area dragging">
            <span className="sap-icon" style={{ fontSize: '2rem' }}>{SAP_ICONS.attachment}</span>
            <div>Dokument hier ablegen</div>
          </div>
        )}

        <footer className="chatbot-input">
          <button
            className="icon-btn"
            title="Dokument hochladen"
            onClick={() => fileInputRef.current?.click()}
            style={{ flexShrink: 0 }}
          >
            <span className="sap-icon">{SAP_ICONS.attachment}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff"
            style={{ display: 'none' }}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = '';
            }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Nachricht..."
            rows={1}
            disabled={isLoading}
          />
          <button
            className="send-btn"
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            title="Senden"
          >
            ↵
          </button>
        </footer>
      </div>
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────

// SAP Icon Unicode references (sap-icon://...)
const SAP_ICONS = {
  attachment: '\ue04a',   // sap-icon://attachment
  step:      '\ue0fe',   // sap-icon://step  (Action)
  inspection:'\ue06e',   // sap-icon://inspection (Document)
  search:    '\ue00d',   // sap-icon://search
  employee:  '\ue036',   // sap-icon://employee
  accept:    '\ue280',   // sap-icon://accept
  upload:    '\ue12e',   // sap-icon://upload
  process:   '\ue0fe',   // sap-icon://step
  list:      '\ue077',   // sap-icon://list
  document:  '\ue019',   // sap-icon://document
  database:  '\ue0e3',   // sap-icon://database
  edit:      '\ue23c',   // sap-icon://edit
  complete:  '\ue05b',   // sap-icon://complete
  alert:     '\ue053',   // sap-icon://alert
  status:    '\ue0b4',   // sap-icon://status-positive
};

const TOOL_META: Record<string, { icon: string; label: string }> = {
  kb_search:              { icon: SAP_ICONS.search,     label: 'Wissensbasis durchsucht' },
  kb_list_topics:         { icon: SAP_ICONS.list,       label: 'Themen aufgelistet' },
  hcm_get_employee:       { icon: SAP_ICONS.employee,   label: 'Mitarbeiterdaten abgerufen' },
  hcm_validate_action:    { icon: SAP_ICONS.accept,     label: 'HR-Aktion validiert' },
  hcm_submit_action:      { icon: SAP_ICONS.edit,     label: 'HR-Aktion eingereicht' },
  docai_analyze_document:  { icon: SAP_ICONS.inspection, label: 'Dokument analysiert' },
  docai_start_extraction:  { icon: SAP_ICONS.upload,    label: 'Schema-Extraktion gestartet' },
  docai_get_extraction:   { icon: SAP_ICONS.document,   label: 'Extraktionsergebnis abgerufen' },
  docai_check_status:     { icon: SAP_ICONS.database,   label: 'vw-doc-ai Status geprüft' },
  docai_list_document_types: { icon: SAP_ICONS.list,     label: 'Dokumenttypen aufgelistet' },
  docai_list_schemas:     { icon: SAP_ICONS.list,       label: 'Schemas abgerufen' },
  docai_list_extractions: { icon: SAP_ICONS.list,       label: 'Extraktionen aufgelistet' },
  docai_review:           { icon: SAP_ICONS.edit,       label: 'Dokument reviewed' },
};

function ToolCallsDisplay({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="tool-calls-container">
      <div className="tool-calls-summary" onClick={() => setExpanded(expanded !== null ? null : 0)}>
        <span className="tool-calls-icon sap-icon">{SAP_ICONS.step}</span>
        <span className="tool-calls-label">
          {toolCalls.length} {toolCalls.length === 1 ? 'Aktion' : 'Aktionen'} ausgeführt
        </span>
        <span className="tool-calls-tools">
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] || { icon: SAP_ICONS.step, label: tc.tool };
            return <span key={i} className="tool-badge sap-icon" title={meta.label}>{meta.icon}</span>;
          })}
        </span>
        <span className={`tool-calls-chevron ${expanded !== null ? 'open' : ''}`}>›</span>
      </div>
      {expanded !== null && (
        <div className="tool-calls-details">
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] || { icon: SAP_ICONS.step, label: tc.tool };
            const isOpen = expanded === i;
            return (
              <div key={i} className={`tool-call-item ${isOpen ? 'open' : ''}`}>
                <div className="tool-call-header" onClick={() => setExpanded(isOpen ? null : i)}>
                  <span className="tool-call-icon sap-icon">{meta.icon}</span>
                  <span className="tool-call-name">{meta.label}</span>
                  <span className={`tool-call-chevron ${isOpen ? 'open' : ''}`}>›</span>
                </div>
                {isOpen && (
                  <div className="tool-call-body">
                    {tc.args && tc.args !== '{}' && (
                      <div className="tool-call-section">
                        <div className="tool-call-section-label">Parameter</div>
                        <pre>{formatJson(tc.args)}</pre>
                      </div>
                    )}
                    <div className="tool-call-section">
                      <div className="tool-call-section-label">Ergebnis</div>
                      <pre>{formatJson(tc.result)}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatJson(jsonStr: string): string {
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2);
  } catch {
    return jsonStr;
  }
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}
