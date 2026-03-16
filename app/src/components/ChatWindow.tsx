import { useState, useRef, useEffect, useCallback, type DragEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { sendMessage, uploadDocument, pollDocumentStatus, type ExtractedField } from '../api';
import '../styles/ChatWindow.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  extractedData?: ExtractedField[];
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
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }]);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.' }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId]);

  // ─── File Upload ──────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    const docType = inferDocumentType(file.name);

    setMessages(prev => [...prev,
      { role: 'user', content: `📎 Dokument hochgeladen: ${file.name}` },
    ]);
    setIsLoading(true);

    try {
      const uploadRes = await uploadDocument(file, docType);

      if (uploadRes.status === 'done') {
        // Sofort Ergebnis abrufen
        const pollRes = await pollDocumentStatus(uploadRes.documentId);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Dokument "${file.name}" wurde verarbeitet. Hier sind die extrahierten Daten:`,
          extractedData: pollRes.extractedData,
        }]);
      } else {
        // Polling starten
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⏳ Dokument "${file.name}" wird von vw-doc-ai verarbeitet. Ich informiere Sie, sobald die Extraktion abgeschlossen ist.`,
        }]);

        // Poll loop
        pollForResult(uploadRes.documentId, file.name);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Fehler beim Upload von "${file.name}".`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pollForResult = useCallback(async (documentId: string, fileName: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await pollDocumentStatus(documentId);
        if (res.status === 'done') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ Extraktion von "${fileName}" abgeschlossen:`,
            extractedData: res.extractedData,
          }]);
          return;
        }
        if (res.status === 'failed') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `❌ Extraktion von "${fileName}" fehlgeschlagen.`,
          }]);
          return;
        }
      } catch {
        break;
      }
    }
  }, []);

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
            <div key={i}>
              <div className={`message ${msg.role === 'user' ? 'user' : 'bot'}`}>
                {msg.content}
              </div>
              {msg.extractedData && (
                <div className="extraction-result">
                  <h4>📄 Extrahierte Daten</h4>
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
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          )}
        </div>

        {/* Drag overlay */}
        {isDragging && (
          <div className="upload-area dragging">
            <i className="fa-solid fa-cloud-arrow-up" />
            <div>Dokument hier ablegen</div>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && !isLoading && (
          <div className="suggestions">
            {suggestions.map(s => (
              <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>{s}</button>
            ))}
          </div>
        )}

        <footer className="chatbot-input">
          <button
            className="icon-btn"
            title="Dokument hochladen"
            onClick={() => fileInputRef.current?.click()}
            style={{ flexShrink: 0 }}
          >
            <i className="fa-solid fa-paperclip" />
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

function inferDocumentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes('vertrag') || lower.includes('contract')) return 'Arbeitsvertrag';
  if (lower.includes('elternzeit') || lower.includes('parental')) return 'Elternzeit-Antrag';
  if (lower.includes('gehalt') || lower.includes('abrechnung') || lower.includes('payslip')) return 'Gehaltsabrechnung';
  return 'custom';
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}
