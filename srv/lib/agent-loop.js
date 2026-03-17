/**
 * Agent Loop – LLM ↔ Tools Orchestrierung
 *
 * Zwei Modi:
 *   1. Workflow-Modus: Personalprodukt aktiv → Workflow-Engine steuert deterministisch
 *   2. LLM-Modus: Kein Workflow → LLM entscheidet frei (KB, Konversation)
 *
 * Das LLM steuert NIE den Prozessablauf eines Personalprodukts.
 * Es wird nur für Dokumentanalyse und freie Konversation genutzt.
 */

const { getToolDefinitions, executeTool } = require('./agent-tools');
const { getProduct, matchProduct, listProducts, getProductChoices } = require('./personalprodukte/registry');
const { executeWorkflowTurn, parseUploadMessage } = require('./workflow-engine');
const stateStore = require('./state-store');

const MAX_ITERATIONS = 8;

/**
 * System-Prompt: Nur noch Persönlichkeit + KB-Modus + Format-Regeln.
 * Die Prozesssteuerung läuft über die Workflow-Engine, nicht über Prompt-Instruktionen.
 */
function buildSystemPrompt() {
  const products = listProducts();
  const productList = products.map(p => `- **${p.label}**`).join('\n');

  return `Du bist ein professioneller HR-Agent bei der VOLKSWAGEN AG.

## Deine Aufgabe
Du beantwortest HR-Fragen und hilfst Mitarbeitern bei Personalprozessen.

## Wissensbasis
Wenn ein Mitarbeiter eine Frage zu HR-Themen hat (Elternzeit, Teilzeit, Regelungen, Fristen):
- Nutze **kb_search** um die Wissensbasis zu durchsuchen
- Antworte auf Basis der gefundenen Informationen
- Wenn die KB keine Treffer liefert, sage das ehrlich

## Verfügbare Personalprodukte
Diese Prozesse können über Dokumenten-Upload gestartet werden:
${productList}

## Verhaltensregeln
1. Antworte immer auf Deutsch
2. Du BIST die Personalabteilung – verweise nicht auf andere Stellen
3. Klar und knapp. 40-120 Wörter.
4. Gib NIEMALS rohe JSON-Daten, Confidence-Werte oder technische Details an den Nutzer weiter
5. Nutze kb_search vor Antworten auf HR-Fragen

## Vorschläge (PFLICHT)
Füge am Ende JEDER Antwort Vorschläge ein:
\`[SUGGESTIONS: Vorschlag 1 | Vorschlag 2 | Vorschlag 3]\`
- 2-4 Vorschläge, kurz (2-6 Wörter)
- Passend zur aktuellen Situation`;
}

/**
 * Führt den Agent-Loop aus.
 *
 * Zwei Modi:
 *   1. Workflow-Modus: Aktives Personalprodukt → Workflow-Engine (deterministisch)
 *   2. LLM-Modus: Kein Workflow → LLM mit Tool-Calling (KB, Konversation)
 *
 * @param {object} openai - OpenAI Client-Instanz
 * @param {string} userMessage - Aktuelle User-Nachricht
 * @param {Array<{role,content}>} history - Bisheriger Chatverlauf
 * @param {object} tools - Tool-Registry aus createTools()
 * @param {string} model - LLM-Modell (Default: gpt-4o-mini)
 * @param {string} [sessionId] - Session-ID für DB-basiertes State Management
 * @returns {{ reply: string, toolCalls: Array, suggestions: string[] }}
 */
async function runAgentLoop(openai, userMessage, history, tools, model = 'gpt-4o-mini', sessionId = null) {

  // ─── Prüfung 1: Aktiver Workflow aus DB-State? ───
  const savedState = await stateStore.loadState(sessionId);

  if (savedState && savedState.state !== 'done') {
    const product = getProduct(savedState.productId);
    if (product) {
      console.log(`\n  🔄 Workflow FORTSETZEN: ${product.label} (State: ${savedState.state})`);

      const result = await executeWorkflowTurn(product, {
        documentId: savedState.documentId,
        caseId: savedState.caseId,
        userMessage,
        tools,
        history,
        openai,
        model,
      }, savedState.state, savedState.data || {});

      if (result) {
        // State in DB persistieren
        if (result.workflowState) {
          await stateStore.saveState(
            result.workflowState.caseId || savedState.caseId,
            result.workflowState,
            sessionId,
          );
        } else if (savedState.caseId) {
          // Workflow abgebrochen (workflowState null) → State canceln
          await stateStore.cancelState(savedState.caseId);
        }
        return {
          reply: result.reply,
          toolCalls: result.toolCalls || [],
          suggestions: result.suggestions || [],
        };
      }
      // result === null → Fallback zum LLM-Modus
    }
  }

  // ─── Prüfung 2: Neuer Dokument-Upload? ───
  const upload = parseUploadMessage(userMessage);
  if (upload) {
    // Produkt über Dateiname + Nachricht matchen
    const match = matchProduct(upload.fileName || '', userMessage);

    if (match) {
      const product = match.product;
      console.log(`\n  📦 NEUER Workflow: ${product.label} (Trigger: ${match.matchedTriggers.join(', ')})`);

      const result = await executeWorkflowTurn(product, {
        documentId: upload.documentId,
        caseId: upload.caseId,
        fileName: upload.fileName,
        userMessage,
        tools,
        history,
        openai,
        model,
      }, 'intake', {});

      if (result) {
        if (result.workflowState?.caseId) {
          await stateStore.saveState(result.workflowState.caseId, result.workflowState, sessionId);
        }
        return {
          reply: result.reply,
          toolCalls: result.toolCalls || [],
          suggestions: result.suggestions || [],
        };
      }
    }

    // Kein Produkt gematcht → Trotzdem analysieren, aber über Engine mit generischem Fallback
    console.log(`\n  📦 Upload erkannt, aber kein Produkt gematcht. Analyse für Matching.`);

    // Dokument generisch analysieren
    const analyzeResult = await executeTool(tools, 'docai_analyze_document', {
      documentId: upload.documentId,
      userMessage,
    });

    const bestType = analyzeResult.analysis?.bestDocType;
    if (bestType) {
      // Versuche Produkt über den erkannten Typ zu matchen
      const product = getProduct(bestType.documentType) ||
        matchProduct(bestType.label || '', bestType.documentType || '')?.product;

      if (product) {
        console.log(`  🎯 LLM-Analyse hat Produkt erkannt: ${product.label}`);
        const response = product.templates.hypothesis({ analysis: analyzeResult.analysis });
        const wsState = {
          productId: product.id,
          state: 'awaiting_confirmation',
          documentId: upload.documentId,
          caseId: upload.caseId,
          data: { analysis: analyzeResult.analysis },
        };
        if (upload.caseId) {
          await stateStore.saveState(upload.caseId, wsState, sessionId);
        }
        return {
          reply: response.text,
          toolCalls: [{ tool: 'docai_analyze_document', args: { documentId: upload.documentId }, result: analyzeResult }],
          suggestions: response.suggestions,
        };
      }
    }

    // Gar nichts erkannt → User fragen
    const choices = getProductChoices();
    return {
      reply: 'Ich konnte den Dokumenttyp leider nicht eindeutig erkennen. Um welche Art von Dokument handelt es sich?',
      toolCalls: [{ tool: 'docai_analyze_document', args: { documentId: upload.documentId }, result: analyzeResult }],
      suggestions: [...choices.slice(0, 3), 'Anderes Dokument'],
    };
  }

  // ─── Modus 3: LLM frei (KB, Konversation, Self-Service) ───
  console.log(`\n  💬 LLM-Modus (kein aktiver Workflow)`);

  const allToolDefinitions = getToolDefinitions(tools);

  // Nur KB- und Info-Tools im LLM-Modus (keine Pipeline-Tools)
  const llmTools = allToolDefinitions.filter(td =>
    ['kb_search', 'kb_list_topics', 'hcm_get_employee', 'docai_list_document_types', 'docai_check_status'].includes(td.function.name)
  );

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...expandHistoryWithToolContext(history),
    { role: 'user', content: userMessage },
  ];

  const toolCallLog = [];

  let supportsTemperature = true; // Wird false wenn Modell temperature:0 ablehnt

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const completionParams = {
      model,
      messages,
    };
    if (supportsTemperature) {
      completionParams.temperature = 0;
      completionParams.seed = 42;
    }
    if (llmTools.length > 0) {
      completionParams.tools = llmTools;
      completionParams.tool_choice = 'auto';
    }

    let completion;
    try {
      completion = await openai.chat.completions.create(completionParams);
    } catch (err) {
      if (supportsTemperature && err.status === 400 && /temperature/i.test(err.message)) {
        console.warn(`  ⚠️ Modell ${model} unterstützt temperature:0 nicht – Retry ohne`);
        supportsTemperature = false;
        delete completionParams.temperature;
        delete completionParams.seed;
        completion = await openai.chat.completions.create(completionParams);
      } else {
        throw err;
      }
    }
    const assistantMessage = completion.choices[0].message;
    messages.push(assistantMessage);

    // Finale Antwort (keine Tool-Calls)
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const { text, suggestions } = parseSuggestions(assistantMessage.content || '');
      return { reply: text, toolCalls: toolCallLog, suggestions };
    }

    // Tool-Calls ausführen
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let args;
      try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

      console.log(`  🔧 LLM Tool-Call: ${toolName}(${JSON.stringify(args)})`);
      const result = await executeTool(tools, toolName, args);
      toolCallLog.push({ tool: toolName, args, result });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Max Iterations
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  const { text, suggestions } = parseSuggestions(lastAssistant?.content || 'Entschuldigung, ich konnte die Anfrage nicht vollständig bearbeiten.');
  return { reply: text, toolCalls: toolCallLog, suggestions };
}

/**
 * Parst Suggestions aus der Agent-Antwort.
 * Erkennt mehrere Formate:
 *   [SUGGESTIONS: A | B | C]
 *   [A | B | C]  (ohne Prefix)
 *   Mehrzeilige Varianten
 */
function parseSuggestions(content) {
  if (!content) return { text: content, suggestions: null };

  // Variante 1: [SUGGESTIONS: A | B | C]
  let match = content.match(/\[SUGGESTIONS:\s*(.+?)\]/is);
  if (match) {
    const suggestions = match[1].split('|').map(s => s.trim()).filter(s => s.length > 0);
    const text = content.replace(/\s*\[SUGGESTIONS:\s*.+?\]/is, '').trim();
    return { text, suggestions: suggestions.length > 0 ? suggestions : null };
  }

  // Variante 2: [A | B | C] am Ende der Nachricht (mind. ein | im Block)
  match = content.match(/\s*\[([^\[\]]*\|[^\[\]]*)\]\s*$/);
  if (match) {
    const suggestions = match[1].split('|').map(s => s.trim()).filter(s => s.length > 0);
    if (suggestions.length >= 2) {
      const text = content.replace(/\s*\[[^\[\]]*\|[^\[\]]*\]\s*$/, '').trim();
      return { text, suggestions };
    }
  }

  return { text: content, suggestions: null };
}

/**
 * Bereinigt Assistant-Nachrichten von internen State-Blöcken.
 * Entfernt [TOOL_CONTEXT:...] und [WORKFLOW_STATE:...] damit das LLM sie nicht sieht.
 */
function expandHistoryWithToolContext(history) {
  const expanded = [];
  const toolContextRegex = /\[TOOL_CONTEXT:(\[.*?\])\]$/s;
  const workflowStateRegex = /\[WORKFLOW_STATE:\{.*?\}\]$/s;

  for (const m of history) {
    if (m.role === 'assistant') {
      let content = m.content || '';

      // Workflow-State entfernen (nur intern)
      content = content.replace(workflowStateRegex, '').trim();

      // Tool-Context entfernen (nur intern)
      const tcMatch = content.match(toolContextRegex);
      if (tcMatch) {
        content = content.replace(toolContextRegex, '').trim();
      }

      if (content) {
        expanded.push({ role: 'assistant', content });
      }
      continue;
    }
    expanded.push({ role: m.role, content: m.content });
  }
  return expanded;
}

module.exports = { runAgentLoop, buildSystemPrompt };
