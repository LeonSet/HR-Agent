const cds = require('@sap/cds');
const { createTools } = require('./lib/agent-tools');
const { runAgentLoop } = require('./lib/agent-loop');

let openaiClient = null;

/**
 * Lazy-Init des OpenAI Clients.
 * Gibt null zurück wenn kein API Key konfiguriert ist → Fallback-Modus.
 */
function getOpenAI() {
  if (openaiClient !== undefined && openaiClient !== null) return openaiClient;

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('⚠️  OPENAI_API_KEY nicht gesetzt – ChatService läuft im Fallback-Modus (kein LLM)');
    openaiClient = null;
    return null;
  }

  if (apiKey.includes('...')) {
    console.warn('⚠️  OPENAI_API_KEY ist noch ein Platzhalter – ChatService läuft im Fallback-Modus');
    openaiClient = null;
    return null;
  }

  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey });
    console.log('✅ OpenAI Client initialisiert');
  } catch (err) {
    console.error('❌ OpenAI init fehlgeschlagen:', err.message);
    openaiClient = null;
  }
  return openaiClient;
}

module.exports = class ChatService extends cds.ApplicationService {

  init() {
    const { Sessions, Messages } = this.entities;

    // DB-Entities für Tools zusammenstellen (ChatService + anderer Services)
    let agentTools = null;

    this.on('sendMessage', async (req) => {
      const { sessionId, message } = req.data;

      // ─── Session erstellen oder laden ───
      let session;
      if (sessionId) {
        session = await SELECT.one.from(Sessions).where({ ID: sessionId });
      }
      if (!session) {
        session = { ID: cds.utils.uuid(), title: message.substring(0, 80) };
        await INSERT.into(Sessions).entries(session);
      }

      // ─── User-Nachricht speichern ───
      await INSERT.into(Messages).entries({
        session_ID: session.ID,
        role: 'user',
        content: message,
      });

      // ─── Bisherigen Verlauf laden (letzte 20 Nachrichten) ───
      const history = await SELECT.from(Messages)
        .where({ session_ID: session.ID })
        .orderBy('createdAt asc')
        .limit(20);

      // ─── Agent-Loop oder Fallback ───
      const openai = getOpenAI();
      let result = null;
      let reply;
      let suggestions;

      if (openai) {
        // Echtes Agent-Verhalten: LLM mit Tool-Calling
        if (!agentTools) {
          // Tools brauchen DB-Entities aus verschiedenen Services
          const dbEntities = {
            Employees: cds.entities['hr.agent.Employees'],
            HCMActions: cds.entities['hr.agent.HCMActions'],
            Documents: cds.entities['hr.agent.Documents'],
            ExtractedFields: cds.entities['hr.agent.ExtractedFields'],
          };
          agentTools = createTools(dbEntities, openai);
        }

        console.log(`\n🤖 Agent-Loop gestartet für: "${message.substring(0, 60)}..."`);

        try {
          result = await runAgentLoop(
            openai,
            message,
            history.filter(m => m.role !== 'system'),
            agentTools,
            process.env.OPENAI_MODEL || 'gpt-4o-mini',
          );

          reply = result.reply;
          // Agent-Suggestions (vom LLM) bevorzugen, Fallback auf regelbasierte
          suggestions = (result.suggestions && result.suggestions.length > 0)
            ? result.suggestions
            : deriveSuggestions(message, result.toolCalls);

          if (result.toolCalls.length > 0) {
            console.log(`  📊 ${result.toolCalls.length} Tool-Calls ausgeführt: ${result.toolCalls.map(t => t.tool).join(', ')}`);
          }
        } catch (err) {
          console.error('❌ Agent-Loop fehlgeschlagen, wechsle in Fallback-Modus:', err.message);
          result = null;
          reply = generateFallbackResponse(message);
          suggestions = generateFallbackSuggestions(message);
        }
      } else {
        // Fallback: einfache regelbasierte Antwort
        reply = generateFallbackResponse(message);
        suggestions = generateFallbackSuggestions(message);
      }

      // ─── Antwort speichern ───
      await INSERT.into(Messages).entries({
        session_ID: session.ID,
        role: 'assistant',
        content: reply,
      });

      // Tool-Calls für das Frontend aufbereiten
      const toolCallsForUI = (result?.toolCalls || []).map(tc => ({
        tool: tc.tool,
        args: JSON.stringify(tc.args),
        result: JSON.stringify(tc.result),
      }));

      return { reply, sessionId: session.ID, suggestions, toolCalls: toolCallsForUI };
    });

    return super.init();
  }
};

// ─── Intelligente Suggestions basierend auf Tool-Calls ──
function deriveSuggestions(message, toolCalls) {
  const usedTools = toolCalls.map(t => t.tool);

  // Dokumenten-Pipeline
  if (usedTools.includes('docai_analyze_document')) {
    return ['Ja, weiter verarbeiten', 'Anderer Dokumenttyp', 'Abbrechen'];
  }

  if (usedTools.includes('docai_start_extraction') || usedTools.includes('docai_get_extraction')) {
    return ['Ergebnis prüfen', 'Aktion einreichen', 'Abbrechen'];
  }

  if (usedTools.includes('kb_search')) {
    const topics = toolCalls
      .filter(t => t.tool === 'kb_search')
      .flatMap(t => t.result?.results?.map(r => r.topic) || []);

    if (topics.includes('Elternzeit')) return ['Antrag einreichen', 'Elterngeld berechnen', 'Dokument hochladen'];
    if (topics.includes('Teilzeit'))   return ['Stunden reduzieren', 'Urlaubsanspruch prüfen', 'Antrag vorbereiten'];
  }

  if (usedTools.includes('hcm_get_employee')) {
    return ['Teilzeit beantragen', 'Urlaubsanspruch prüfen', 'Adresse ändern'];
  }

  if (usedTools.includes('hcm_validate_action')) {
    return ['Aktion einreichen', 'Details ändern', 'Abbrechen'];
  }

  return generateFallbackSuggestions(message);
}

// ─── Fallback wenn kein LLM verfügbar ───────────────────
function generateFallbackResponse(message) {
  const msg = message.toLowerCase();

  if (msg.includes('hallo') || msg.includes('hi') || msg.includes('guten tag') || msg.includes('moin')) {
    return 'Hallo! Willkommen im HR Beratungscenter. Ich bin Ihr HR-Agent und kann Sie bei Personalthemen unterstützen. ' +
      '⚠️ Hinweis: Der Agent läuft aktuell ohne LLM (kein OPENAI_API_KEY konfiguriert). ' +
      'Grundfunktionen sind verfügbar, aber intelligente Beratung erfordert einen API-Key.';
  }
  if (msg.includes('elternzeit'))
    return 'Elternzeit: Bis zu 3 Jahre pro Kind (BEEG §16). Antrag mind. 7 Wochen vorher. [Fallback-Modus – LLM nicht konfiguriert]';
  if (msg.includes('teilzeit'))
    return 'Teilzeit: Anspruch ab 6 Monaten Betriebszugehörigkeit (§§8ff. TzBfG). Antrag 3 Monate vorher. [Fallback-Modus]';

  return 'Ich bin der HR-Agent für NOVENTIS. ⚠️ LLM-Modus ist nicht aktiv (OPENAI_API_KEY fehlt). ' +
    'Bitte konfigurieren Sie den API-Key in der .env-Datei für volle Agent-Funktionalität.';
}

function generateFallbackSuggestions(message) {
  const msg = message.toLowerCase();
  if (msg.includes('elternzeit')) return ['Elternzeit beantragen', 'Elterngeld berechnen', 'Dokument hochladen'];
  if (msg.includes('teilzeit'))   return ['Teilzeit-Modelle', 'Urlaubsanspruch', 'Antrag vorbereiten'];
  return ['Elternzeit beantragen', 'Teilzeit beantragen', 'Dokument hochladen'];
}
