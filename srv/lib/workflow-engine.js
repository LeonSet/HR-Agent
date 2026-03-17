/**
 * Workflow-Engine – Deterministische Prozesssteuerung
 *
 * Die universelle Pipeline für alle Personalprodukte.
 * Das Produkt liefert die Konfiguration (Schema, Felder, Templates).
 * Die Engine führt die Schritte deterministisch aus.
 *
 * KEIN LLM entscheidet über den Prozessablauf.
 * Das LLM wird nur für die Dokumentanalyse (docai_analyze_document) genutzt.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  Workflow-Zustände (DB-persistent via state-store.js)               │
 * │                                                                    │
 * │  intake → analyzed → awaiting_confirmation                         │
 * │     ↓ (User bestätigt)                                             │
 * │  extracting → extracted → employee_found                           │
 * │     ↓                                                              │
 * │  validated → awaiting_approval → awaiting_correction               │
 * │     ↓ (User genehmigt)                                            │
 * │  submitted → done                                                  │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * State-Persistierung: Cases-Tabelle (via state-store.js)
 * Alte [WORKFLOW_STATE:...]-Serialisierung in Chat-Nachrichten wurde entfernt.
 */

const { executeTool } = require('./agent-tools');

// ─── Intent-Klassifikation ──────────────────────────────

const VALID_INTENTS = ['confirm', 'deny', 'extract_only', 'correct', 'unclear'];

const INTENT_SYSTEM_PROMPT = `Du bist ein Intent-Klassifikator für einen HR-Workflow.
Klassifiziere die Benutzer-Nachricht in GENAU EINE Kategorie:

- confirm: Zustimmung, Bestätigung, weiter machen, einreichen, vorbereiten (z.B. "Ja", "Ok", "Mach das", "Weiter", "Einreichen")
- deny: Ablehnung, Abbruch, Stopp (z.B. "Nein", "Abbrechen", "Stopp", "Nicht richtig")
- extract_only: Nur Daten anzeigen/prüfen, ohne Aktion auszuführen (z.B. "Nur Daten zeigen", "Welche Daten hast du?", "Nein, nur prüfen")
- correct: Daten korrigieren, ändern, anpassen (z.B. "Korrigieren", "Ändern", "Das Datum stimmt nicht")
- unclear: Nachricht passt in keine der obigen Kategorien

Antworte NUR mit dem Kategorie-Namen (confirm, deny, extract_only, correct oder unclear). Kein anderer Text.`;

/**
 * Klassifiziert die User-Absicht in einem Workflow-Kontext (LLM-basiert).
 *
 * Erkennt 5 Absichten:
 *   - 'confirm'      → Ja, weiter, einreichen, vorbereiten
 *   - 'deny'         → Nein, abbrechen, stopp
 *   - 'extract_only' → Nur Daten zeigen/prüfen, nicht einreichen
 *   - 'correct'      → Daten korrigieren, ändern
 *   - 'unclear'      → Keiner der obigen
 *
 * Nutzt LLM wenn openai+model vorhanden, sonst Regex-Fallback.
 */
async function classifyIntent(msg, openai, model) {
  if (!msg) return 'unclear';

  // ─── LLM-Klassifikation ───
  if (openai && model) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: INTENT_SYSTEM_PROMPT },
          { role: 'user', content: msg },
        ],
        max_completion_tokens: 20,
      });

      const raw = (completion.choices[0]?.message?.content || '').trim().toLowerCase();
      const intent = VALID_INTENTS.find(i => raw.includes(i));
      if (intent) {
        console.log(`  🤖 LLM-Intent: ${intent} (raw: "${raw}")`);
        return intent;
      }
      console.warn(`  ⚠️ LLM-Intent nicht erkannt: "${raw}" → Regex-Fallback`);
    } catch (err) {
      console.warn(`  ⚠️ LLM-Intent-Fehler: ${err.message} → Regex-Fallback`);
    }
  }

  // ─── Regex-Fallback ───
  return classifyIntentRegex(msg);
}

/**
 * Regex-basierter Fallback für Intent-Klassifikation.
 * Wird genutzt wenn kein LLM verfügbar oder LLM-Aufruf fehlschlägt.
 */
function classifyIntentRegex(msg) {
  if (!msg) return 'unclear';
  const m = msg.trim().toLowerCase();

  if (/korrigier|änder|bearbeit|anpass/.test(m)) return 'correct';

  if (/^nein\b/.test(m)) {
    if (/nur|zeig|sag|welche|daten|prüf|check|schau|anzeig|extrahier/.test(m)) return 'extract_only';
    return 'deny';
  }

  if (/^(no\b|falsch\b|stimmt nicht|abbrech|stopp|cancel\b|nicht richtig)/.test(m)) return 'deny';

  if (/nur.+(?:daten|prüf|zeig|anschau|check|extrahier)|(?:daten|felder).+(?:prüf|zeig|anschau)|welche.+daten/.test(m)) return 'extract_only';

  if (/^(ja\b|yes\b|ok\b|genau\b|richtig\b|stimmt\b|korrekt\b|passt\b|mach\b|los\b|weiter\b)/.test(m)) return 'confirm';

  if (/einreich|verbuch|vorbereiten|verarbeit|extrahier/.test(m)) return 'confirm';

  return 'unclear';
}

/**
 * Erkennt, ob die User-Nachricht einen Dokument-Upload enthält.
 * Das Frontend sendet: 'Ein Dokument wurde hochgeladen (documentId: "xxx", ...)'
 *
 * @returns {{ documentId, caseId, fileName } | null}
 */
function parseUploadMessage(userMessage) {
  if (!userMessage) return null;
  const docMatch = userMessage.match(/documentId:\s*"([^"]+)"/);
  const caseMatch = userMessage.match(/caseId:\s*"([^"]+)"/);
  const fileMatch = userMessage.match(/Datei:\s*"([^"]+)"/);
  if (docMatch) {
    return {
      documentId: docMatch[1],
      caseId: caseMatch?.[1] || null,
      fileName: fileMatch?.[1] || null,
    };
  }
  return null;
}

// ─── Workflow-Engine ────────────────────────────────────

/**
 * Führt einen Workflow-Turn aus.
 *
 * Wird vom Agent-Loop aufgerufen, wenn ein aktiver Workflow erkannt wird.
 * Gibt { reply, suggestions, toolCalls, workflowState } zurück.
 *
 * @param {object} product - Die Personalprodukt-Definition
 * @param {object} ctx - { documentId, caseId, fileName, userMessage, tools, history }
 * @param {string} currentState - Aktueller Workflow-Zustand
 * @param {object} stateData - Akkumulierte Daten aus früheren Turns
 * @returns {Promise<{ reply, suggestions, toolCalls, workflowState }>}
 */
async function executeWorkflowTurn(product, ctx, currentState, stateData) {
  const toolCalls = [];
  const data = { ...stateData }; // Mutable copy

  console.log(`  ⚙️  Workflow-Engine: Produkt=${product.id}, State=${currentState}`);

  switch (currentState) {

    // ═══════════════════════════════════════════════════
    // TURN 1: Dokument → Analyse → Hypothese
    // ═══════════════════════════════════════════════════
    case 'intake': {
      // Schritt 1: Dokument analysieren
      const analyzeResult = await executeTool(ctx.tools, 'docai_analyze_document', {
        documentId: ctx.documentId,
        userMessage: ctx.userMessage,
      });
      toolCalls.push({ tool: 'docai_analyze_document', args: { documentId: ctx.documentId }, result: analyzeResult });

      data.analysis = analyzeResult.analysis;

      // Schritt 2: Hypothese als Template-Antwort
      const response = product.templates.hypothesis({ analysis: data.analysis });

      return {
        reply: response.text,
        suggestions: response.suggestions,
        toolCalls,
        workflowState: {
          productId: product.id,
          state: 'awaiting_confirmation',
          documentId: ctx.documentId,
          caseId: ctx.caseId,
          data,
        },
      };
    }

    // ═══════════════════════════════════════════════════
    // TURN 2: User reagiert auf Hypothese
    // ═══════════════════════════════════════════════════
    case 'awaiting_confirmation': {
      const confirmIntent = await classifyIntent(ctx.userMessage, ctx.openai, ctx.model);
      console.log(`  📋 Intent: ${confirmIntent} ("${ctx.userMessage.substring(0, 40)}")`)

      if (confirmIntent === 'deny') {
        const { getProductChoices } = require('./personalprodukte/registry');
        const choices = getProductChoices();
        return {
          reply: 'Verstanden, der Vorgang wird abgebrochen. Um welche Art von Dokument handelt es sich stattdessen?',
          suggestions: [...choices.slice(0, 3), 'Abbrechen'],
          toolCalls: [],
          workflowState: { productId: product.id, state: 'cancelled', documentId: ctx.documentId, caseId: ctx.caseId, data },
        };
      }

      if (confirmIntent === 'unclear') {
        // Klare Optionen anbieten, NICHT das Template wiederholen
        return {
          reply: `Ich bin mir nicht sicher, was Sie möchten. Für Ihren **${product.label}** kann ich:\n\n` +
            '1. **Daten extrahieren und Erstattung vorbereiten** (vollständiger Prozess)\n' +
            '2. **Nur die Daten prüfen** (ohne Erstattung)\n' +
            '3. **Abbrechen**',
          suggestions: ['Erstattung vorbereiten', 'Nur Daten prüfen', 'Abbrechen'],
          toolCalls: [],
          workflowState: {
            productId: product.id,
            state: 'awaiting_confirmation',
            documentId: ctx.documentId,
            caseId: ctx.caseId,
            data,
          },
        };
      }

      // ─── confirm ODER extract_only → Extraktion starten ───
      // Bei extract_only: Daten zeigen, Einreichung optional anbieten
      // Bei confirm: voller Prozess inkl. Validierung + Einreichungs-Frage

      // Schritt 1: Extraktion starten
      const startResult = await executeTool(ctx.tools, 'docai_start_extraction', {
        documentId: ctx.documentId,
        documentType: product.id === 'fibu24' ? 'Fibu24-Nachweis' : product.label,
      });
      toolCalls.push({ tool: 'docai_start_extraction', args: { documentId: ctx.documentId, documentType: product.label }, result: startResult });

      if (startResult.error) {
        return {
          reply: `Bei der Dokumentverarbeitung ist ein Fehler aufgetreten: ${startResult.error}`,
          suggestions: ['Erneut versuchen', 'Abbrechen'],
          toolCalls,
          workflowState: null,
        };
      }

      // Schritt 2: Extraktion abholen
      const jobId = startResult.jobId;
      const getResult = await executeTool(ctx.tools, 'docai_get_extraction', {
        documentId: ctx.documentId,
        jobId,
      });
      toolCalls.push({ tool: 'docai_get_extraction', args: { documentId: ctx.documentId, jobId }, result: getResult });

      const fields = getResult.extractedFields || [];
      data.extraction = getResult;

      // Schritt 3: Pflichtfelder prüfen
      const missing = product.requiredFields.filter(req =>
        !fields.some(f => (f.fieldName || f.name) === req.field && (f.fieldValue || f.value))
      );

      if (missing.length > 0) {
        const response = product.templates.missingFields(missing);
        return {
          reply: response.text,
          suggestions: response.suggestions,
          toolCalls,
          workflowState: {
            productId: product.id,
            state: 'awaiting_fields',
            documentId: ctx.documentId,
            caseId: ctx.caseId,
            data,
          },
        };
      }

      // Schritt 4: Mitarbeiter suchen
      return await lookupAndValidate(product, ctx, data, fields, toolCalls);
    }

    // ═══════════════════════════════════════════════════
    // User liefert fehlende Felder nach
    // ═══════════════════════════════════════════════════
    case 'awaiting_fields': {
      const intent = await classifyIntent(ctx.userMessage, ctx.openai, ctx.model);
      if (intent === 'deny') {
        return {
          reply: 'Verstanden, der Vorgang wird abgebrochen.',
          suggestions: ['Neues Dokument hochladen', 'Frage stellen'],
          toolCalls: [],
          workflowState: { productId: product.id, state: 'cancelled', documentId: ctx.documentId, caseId: ctx.caseId, data },
        };
      }

      // Versuche "Feld: Wert" oder "Wert" aus der Nachricht zu parsen
      const fields = data.extraction?.extractedFields || [];
      const missing = product.requiredFields.filter(req =>
        !fields.some(f => (f.fieldName || f.name) === req.field && (f.fieldValue || f.value))
      );

      // Einfaches Parsing: wenn genau 1 Feld fehlt, nehme die ganze Nachricht als Wert
      if (missing.length === 1) {
        const value = ctx.userMessage.trim();
        if (value && value.length < 100) {
          fields.push({ fieldName: missing[0].field, fieldValue: value });
        }
      } else {
        // Versuche "Feld: Wert" Pattern
        const patterns = ctx.userMessage.match(/(\w[\w\s]*\w)\s*:\s*(.+)/g);
        if (patterns) {
          for (const p of patterns) {
            const [, name, value] = p.match(/(\w[\w\s]*\w)\s*:\s*(.+)/);
            const target = fields.find(f =>
              (f.fieldName || f.name).toLowerCase().includes(name.trim().toLowerCase())
            ) || missing.find(m => m.field.toLowerCase().includes(name.trim().toLowerCase()));
            if (target) {
              const fieldName = target.fieldName || target.field || target.name;
              const existing = fields.find(f => (f.fieldName || f.name) === fieldName);
              if (existing) {
                existing.fieldValue = value.trim();
                existing.value = value.trim();
              } else {
                fields.push({ fieldName, fieldValue: value.trim() });
              }
            }
          }
        }
      }

      data.extraction = data.extraction || {};
      data.extraction.extractedFields = fields;
      return await lookupAndValidate(product, ctx, data, fields, toolCalls);
    }

    // ═══════════════════════════════════════════════════
    // User liefert Personalnummer nach
    // ═══════════════════════════════════════════════════
    case 'awaiting_employee': {
      // Versuche Personalnummer aus User-Nachricht zu extrahieren
      const pnrMatch = ctx.userMessage.match(/\d{6,8}/);
      if (pnrMatch) {
        const empResult = await executeTool(ctx.tools, 'hcm_get_employee', {
          personnelNumber: pnrMatch[0].padStart(8, '0'),
        });
        toolCalls.push({ tool: 'hcm_get_employee', args: { personnelNumber: pnrMatch[0] }, result: empResult });

        if (empResult.found) {
          data.employee = empResult.employee;

          // Cross-Validierung
          const fields = data.extraction?.extractedFields || [];
          data.validationResult = product.validation(fields);

          const response = product.templates.extractionSummary(data);
          return {
            reply: response.text,
            suggestions: response.suggestions,
            toolCalls,
            workflowState: {
              productId: product.id,
              state: 'awaiting_approval',
              documentId: ctx.documentId,
              caseId: ctx.caseId,
              data,
            },
          };
        }
      }

      // Nicht gefunden → nochmal fragen
      return {
        reply: 'Ich konnte keinen Mitarbeiter mit dieser Nummer finden. Bitte geben Sie die korrekte 8-stellige Personalnummer ein.',
        suggestions: ['Personalnummer eingeben', 'Abbrechen'],
        toolCalls,
        workflowState: {
          productId: product.id,
          state: 'awaiting_employee',
          documentId: ctx.documentId,
          caseId: ctx.caseId,
          data,
        },
      };
    }

    // ═══════════════════════════════════════════════════
    // User hat Korrektur-Werte geliefert
    // ═══════════════════════════════════════════════════
    case 'awaiting_correction': {
      const fields = data.extraction?.extractedFields || [];

      // "Feld: Wert" Pattern parsen
      const patterns = ctx.userMessage.match(/(\w[\w\s]*\w)\s*:\s*(.+)/g);
      if (patterns) {
        for (const p of patterns) {
          const [, name, value] = p.match(/(\w[\w\s]*\w)\s*:\s*(.+)/);
          const field = fields.find(f =>
            (f.fieldName || f.name).toLowerCase().includes(name.trim().toLowerCase())
          );
          if (field) {
            field.fieldValue = value.trim();
            field.value = value.trim();
          }
        }
        data.extraction.extractedFields = fields;
      }

      // Re-Validierung + Summary
      return await lookupAndValidate(product, ctx, data, fields, toolCalls);
    }

    // ═══════════════════════════════════════════════════
    // TURN 3: User genehmigt → Einreichung
    // ═══════════════════════════════════════════════════
    case 'awaiting_approval': {
      const approvalIntent = await classifyIntent(ctx.userMessage, ctx.openai, ctx.model);
      console.log(`  📋 Approval-Intent: ${approvalIntent} ("${ctx.userMessage.substring(0, 40)}")`)

      if (approvalIntent === 'deny') {
        return {
          reply: 'Verstanden, der Vorgang wird abgebrochen.',
          suggestions: ['Neues Dokument hochladen', 'Frage stellen'],
          toolCalls: [],
          workflowState: { productId: product.id, state: 'cancelled', documentId: ctx.documentId, caseId: ctx.caseId, data },
        };
      }

      if (approvalIntent === 'correct') {
        const fields = data.extraction?.extractedFields || [];
        const fieldList = fields
          .filter(f => f.fieldValue || f.value)
          .map(f => `- **${f.fieldName || f.name}:** ${f.fieldValue || f.value}`)
          .join('\n');
        return {
          reply: `Welche Daten sollen korrigiert werden?\n\n${fieldList}\n\nBitte geben Sie die Korrektur im Format **Feldname: Wert** an (z.B. \"Vorname: Max\").`,
          suggestions: ['Abbrechen'],
          toolCalls: [],
          workflowState: {
            productId: product.id,
            state: 'awaiting_correction',
            documentId: ctx.documentId,
            caseId: ctx.caseId,
            data,
          },
        };
      }

      if (approvalIntent === 'unclear' || approvalIntent === 'extract_only') {
        return {
          reply: 'Möchten Sie die Daten einreichen, korrigieren oder den Vorgang abbrechen?',
          suggestions: ['Ja, einreichen', 'Daten korrigieren', 'Abbrechen'],
          toolCalls: [],
          workflowState: {
            productId: product.id,
            state: 'awaiting_approval',
            documentId: ctx.documentId,
            caseId: ctx.caseId,
            data,
          },
        };
      }

      // ─── confirm → Einreichung ───

      // Validierung
      const fields = data.extraction?.extractedFields || [];
      const employeeId = data.employee?.personnelNumber || 'unknown';
      const payload = {};
      for (const f of fields) {
        payload[f.fieldName || f.name] = f.fieldValue || f.value;
      }

      const validateResult = await executeTool(ctx.tools, 'hcm_validate_action', {
        actionType: product.hcmAction,
        payload: JSON.stringify(payload),
      });
      toolCalls.push({ tool: 'hcm_validate_action', args: { actionType: product.hcmAction }, result: validateResult });

      if (!validateResult.valid) {
        const response = product.templates.validationFailed(validateResult.messages || []);
        return {
          reply: response.text,
          suggestions: response.suggestions,
          toolCalls,
          workflowState: {
            productId: product.id,
            state: 'awaiting_approval',
            documentId: ctx.documentId,
            caseId: ctx.caseId,
            data,
          },
        };
      }

      // Einreichung
      const submitResult = await executeTool(ctx.tools, 'hcm_submit_action', {
        actionType: product.hcmAction,
        employeeId,
        payload: JSON.stringify(payload),
      });
      toolCalls.push({ tool: 'hcm_submit_action', args: { actionType: product.hcmAction, employeeId }, result: submitResult });

      const response = product.templates.submitted();
      return {
        reply: response.text,
        suggestions: response.suggestions,
        toolCalls,
        workflowState: {
          productId: product.id,
          state: 'done',
          documentId: ctx.documentId,
          caseId: ctx.caseId,
          data,
        },
      };
    }

    default: {
      console.warn(`  ⚠️ Unbekannter Workflow-State: ${currentState}`);
      return null; // Fallback zum Agent-Loop
    }
  }
}

/**
 * Interner Helfer: Mitarbeiter suchen + Cross-Validierung + Summary
 */
async function lookupAndValidate(product, ctx, data, fields, toolCalls) {
  // Mitarbeiter suchen über das konfigurierte Feld
  const lookupValue = fields.find(f =>
    (f.fieldName || f.name) === product.employee.lookupField
  );

  if (lookupValue) {
    const searchParams = {};
    if (product.employee.lookupType === 'personnelNumber') {
      searchParams.personnelNumber = lookupValue.fieldValue || lookupValue.value;
    } else {
      searchParams.lastName = lookupValue.fieldValue || lookupValue.value;
    }

    const empResult = await executeTool(ctx.tools, 'hcm_get_employee', searchParams);
    toolCalls.push({ tool: 'hcm_get_employee', args: searchParams, result: empResult });

    if (empResult.found) {
      data.employee = empResult.employee;
    }
  }

  // Cross-Validierung
  data.validationResult = product.validation(fields);

  // Wenn kein Mitarbeiter gefunden → nachfragen
  if (!data.employee) {
    const response = product.templates.employeeNotFound(data);
    return {
      reply: response.text,
      suggestions: response.suggestions,
      toolCalls,
      workflowState: {
        productId: product.id,
        state: 'awaiting_employee',
        documentId: ctx.documentId,
        caseId: ctx.caseId,
        data,
      },
    };
  }

  // Alles da → Summary
  const response = product.templates.extractionSummary(data);
  return {
    reply: response.text,
    suggestions: response.suggestions,
    toolCalls,
    workflowState: {
      productId: product.id,
      state: 'awaiting_approval',
      documentId: ctx.documentId,
      caseId: ctx.caseId,
      data,
    },
  };
}

module.exports = {
  executeWorkflowTurn,
  parseUploadMessage,
  classifyIntent,
  classifyIntentRegex,
};
