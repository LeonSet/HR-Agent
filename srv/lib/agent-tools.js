/**
 * Agent Tools – Definitionen und Executor
 *
 * Definiert alle Tools, die dem LLM zur Verfügung stehen.
 * Jedes Tool hat:
 *   - definition: OpenAI Function-Calling Schema (MCP-kompatibel)
 *   - execute: Die tatsächliche Ausführungsfunktion
 */

const { searchKnowledge, listTopics } = require('./knowledge-base');
const vwDocAi = require('./vw-doc-ai-client');
const { runCrossValidation, listSchemas, getSchema, getWorkflowSummary, resolveUploadConfig, getSimulatedExtraction } = require('./document-schemas');
const cds = require('@sap/cds');

/**
 * Lazy-Load pdf-parse: wird bei jedem Aufruf frisch versucht,
 * nicht einmal bei Module-Init (wo Fehler still verschluckt werden).
 */
function getPdfParser() {
  try {
    return require('pdf-parse');
  } catch (e) {
    console.error(`❌ pdf-parse konnte nicht geladen werden: ${e.message}`);
    return null;
  }
}

/**
 * Erstellt die Tool-Definitionen und Executors.
 * Wird mit den CDS-Service-Entities und dem OpenAI-Client aufgerufen.
 */
function createTools(db, openaiClient) {
  const { Employees, HCMActions, Documents, ExtractedFields } = db;

  const tools = {
    // ─── Tool 1: Knowledge Base durchsuchen ──────────────
    kb_search: {
      definition: {
        type: 'function',
        function: {
          name: 'kb_search',
          description:
            'Durchsucht die HR-Wissensbasis nach relevanten Informationen zu Personalthemen. ' +
            'Verwende dieses Tool, um Fragen zu Elternzeit, Teilzeit, Altersteilzeit, ' +
            'Sabbatical, Home-Office, HR-Prozessen und betrieblichen Regelungen zu beantworten.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Die Suchanfrage – beschreibe das Thema, zu dem du Informationen brauchst',
              },
            },
            required: ['query'],
          },
        },
      },
      execute: async ({ query }) => {
        const results = searchKnowledge(query, 3);
        if (results.length === 0) {
          return { found: false, message: 'Keine relevanten Einträge in der Knowledge Base gefunden.' };
        }
        return {
          found: true,
          results: results.map(r => ({
            topic: r.topic,
            content: r.content,
          })),
        };
      },
    },

    // ─── Tool 2: Liste aller KB-Themen ───────────────────
    kb_list_topics: {
      definition: {
        type: 'function',
        function: {
          name: 'kb_list_topics',
          description: 'Listet alle verfügbaren Themen in der HR Knowledge Base auf.',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: async () => {
        return { topics: listTopics() };
      },
    },

    // ─── Tool 3: Mitarbeiterdaten abrufen ────────────────
    hcm_get_employee: {
      definition: {
        type: 'function',
        function: {
          name: 'hcm_get_employee',
          description:
            'Ruft Mitarbeiterdaten aus dem SAP HCM System ab. ' +
            'Liefert: Personalnummer, Name, Abteilung, Position, Wochenarbeitszeit, Eintrittsdatum, Kostenstelle. ' +
            'Verwende dieses Tool, wenn du Informationen über einen Mitarbeiter brauchst. ' +
            'Suche per Personalnummer ODER Nachname (mindestens ein Parameter angeben).',
          parameters: {
            type: 'object',
            properties: {
              personnelNumber: {
                type: 'string',
                description: 'Die 8-stellige Personalnummer des Mitarbeiters (z.B. "00012345").',
              },
              lastName: {
                type: 'string',
                description: 'Nachname des Mitarbeiters für die Suche (z.B. "Kirchhoff").',
              },
              firstName: {
                type: 'string',
                description: 'Vorname des Mitarbeiters zur Eingrenzung bei Nachname-Suche (z.B. "Andrea").',
              },
            },
          },
        },
      },
      execute: async ({ personnelNumber, lastName, firstName }) => {
        let employee;
        if (personnelNumber) {
          employee = await SELECT.one.from(Employees).where({ personnelNumber });
        } else if (lastName && firstName) {
          employee = await SELECT.one.from(Employees).where({ lastName, firstName });
        } else if (lastName) {
          employee = await SELECT.one.from(Employees).where({ lastName });
        } else {
          return { found: false, message: 'Bitte Personalnummer oder Nachname angeben.' };
        }

        if (employee) {
          return {
            found: true,
            employee: {
              personnelNumber: employee.personnelNumber,
              firstName: employee.firstName,
              lastName: employee.lastName,
              email: employee.email,
              department: employee.department,
              position: employee.position,
              entryDate: employee.entryDate,
              weeklyHours: employee.weeklyHours,
              costCenter: employee.costCenter,
            },
          };
        }

        // Simulierte Daten als Fallback
        return {
          found: false,
          message: `Kein Mitarbeiter mit Personalnummer "${personnelNumber}" gefunden. Bitte den Benutzer nach der korrekten Personalnummer fragen.`,
        };
      },
    },

    // ─── Tool 4: HR-Aktion validieren ────────────────────
    hcm_validate_action: {
      definition: {
        type: 'function',
        function: {
          name: 'hcm_validate_action',
          description:
            'Validiert eine geplante HR-Aktion gegen die SAP HCM Regeln. ' +
            'Prüft ob alle Voraussetzungen erfüllt sind und gibt Validierungsergebnisse zurück. ' +
            'Mögliche actionTypes: elternzeit, teilzeit, vollzeit_rueckkehr, altersteilzeit, sabbatical, adressaenderung, gehaltsanpassung.',
          parameters: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                enum: ['elternzeit', 'teilzeit', 'vollzeit_rueckkehr', 'altersteilzeit', 'sabbatical', 'adressaenderung', 'gehaltsanpassung', 'fibu24_erstattung', 'krankmeldung', 'reisekostenerstattung'],
                description: 'Art der HR-Aktion',
              },
              payload: {
                type: 'string',
                description: 'JSON-String mit Aktionsdetails. Für elternzeit: {"beginn":"YYYY-MM-DD","ende":"YYYY-MM-DD"}. Für teilzeit: {"wochenstunden":30,"beginn":"YYYY-MM-DD"}. Für vollzeit_rueckkehr: {"beginn":"YYYY-MM-DD"}.',
              },
            },
            required: ['actionType', 'payload'],
          },
        },
      },
      execute: async ({ actionType, payload }) => {
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          return { valid: false, messages: ['Ungültiges JSON im Payload'] };
        }

        const messages = [];
        let valid = true;

        switch (actionType) {
          case 'elternzeit':
            if (!data.beginn) { valid = false; messages.push('Beginn der Elternzeit fehlt'); }
            if (!data.ende) { valid = false; messages.push('Ende der Elternzeit fehlt'); }
            if (data.beginn && data.ende && new Date(data.beginn) >= new Date(data.ende)) {
              valid = false; messages.push('Beginn muss vor dem Ende liegen');
            }
            if (valid) messages.push('Validierung erfolgreich – Elternzeit-Antrag kann eingereicht werden');
            break;

          case 'teilzeit':
            if (!data.wochenstunden) { valid = false; messages.push('Gewünschte Wochenstunden fehlen'); }
            if (data.wochenstunden && (data.wochenstunden < 5 || data.wochenstunden > 39)) {
              valid = false; messages.push('Wochenstunden müssen zwischen 5 und 39 liegen');
            }
            if (!data.beginn) { valid = false; messages.push('Gewünschter Beginn fehlt'); }
            if (valid) {
              const urlaubsanspruch = 30 * (data.wochenstunden / 40);
              messages.push(`Validierung erfolgreich. Neuer Urlaubsanspruch: ${urlaubsanspruch.toFixed(1)} Tage.`);
            }
            break;

          case 'vollzeit_rueckkehr':
            if (!data.beginn) { valid = false; messages.push('Gewünschtes Rückkehrdatum fehlt'); }
            if (valid) messages.push('Validierung erfolgreich – Rückkehr in Vollzeit kann eingeleitet werden');
            break;

          default:
            if (valid) messages.push(`Aktion '${actionType}' vorvalidiert`);
        }

        return { valid, messages };
      },
    },

    // ─── Tool 5: HR-Aktion einreichen ────────────────────
    hcm_submit_action: {
      definition: {
        type: 'function',
        function: {
          name: 'hcm_submit_action',
          description:
            'Reicht eine HR-Aktion im SAP HCM System ein (simuliert). ' +
            'Erstellt einen Datensatz mit Status "simuliert". ' +
            'WICHTIG: Nur nach expliziter Bestätigung durch den Benutzer verwenden!',
          parameters: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                enum: ['elternzeit', 'teilzeit', 'vollzeit_rueckkehr', 'altersteilzeit', 'sabbatical', 'fibu24_erstattung', 'krankmeldung', 'reisekostenerstattung'],
                description: 'Art der HR-Aktion',
              },
              employeeId: {
                type: 'string',
                description: 'UUID des Mitarbeiters',
              },
              payload: {
                type: 'string',
                description: 'JSON-String mit den Aktionsdetails',
              },
            },
            required: ['actionType', 'employeeId', 'payload'],
          },
        },
      },
      execute: async ({ actionType, employeeId, payload }) => {
        const actionId = cds.utils.uuid();
        await INSERT.into(HCMActions).entries({
          ID: actionId,
          employee_ID: employeeId,
          actionType,
          status: 'simuliert',
          payload,
          result: JSON.stringify({
            message: `${actionType} wurde simuliert eingereicht`,
            timestamp: new Date().toISOString(),
          }),
        });

        return {
          actionId,
          status: 'simuliert',
          message: `HR-Aktion '${actionType}' erfolgreich simuliert eingereicht. ` +
            'In Produktion wird diese Aktion im SAP HCM System verarbeitet.',
        };
      },
    },

    // ─── Tool 6: LLM-basierte Dokumentanalyse (Phase 1 – First Look) ──
    // Nutzt GPT-4o Vision für Bilder oder PDF-Textextraktion für einen echten Blick ins Dokument
    docai_analyze_document: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_analyze_document',
          description:
            'Analysiert ein hochgeladenes Dokument per KI-Vision (Bilder) oder Textextraktion (PDF). ' +
            'Liefert eine fundierte Einschätzung zu Dokumenttyp und Inhalt. ' +
            'Verwende dieses Tool DIREKT nach einem Dokument-Upload.',
          parameters: {
            type: 'object',
            properties: {
              documentId: {
                type: 'string',
                description: 'Die UUID des hochgeladenen Dokuments',
              },
              userMessage: {
                type: 'string',
                description: 'Die begleitende Nachricht des Nutzers (kann leer sein)',
              },
            },
            required: ['documentId'],
          },
        },
      },
      execute: async ({ documentId, userMessage }) => {
        const doc = await SELECT.one.from(Documents).where({ ID: documentId });
        if (!doc) return { error: 'Dokument nicht gefunden.' };

        const { Cases, CaseEvents } = cds.entities('hr.agent');
        const availableTypes = listSchemas();
        const workflowList = availableTypes.map(t =>
          `- ${t.documentType}: ${t.label} (Schlüsselwörter: ${t.triggers.slice(0, 6).join(', ')})`
        ).join('\n');

        // ─── 1. Buffer prüfen (NICHT still übergehen) ───
        const fileBuffer = global._pendingBuffers?.[documentId];
        const mimeType = (doc.mimeType || '').toLowerCase();
        const warnings = [];

        if (!fileBuffer) {
          console.error(`  ❌ KEIN Buffer für Dokument ${documentId} (${doc.fileName}) – Server-Restart oder bereits verarbeitet?`);
          warnings.push('Dokument-Buffer nicht verfügbar (möglicherweise bereits verarbeitet)');
        } else {
          console.log(`  📋 Buffer vorhanden: ${Math.round(fileBuffer.length / 1024)}KB, MIME: ${mimeType}`);
        }

        // ─── 2. Dokument-Inhalt für LLM aufbereiten ───
        let contentParts = [];
        let extractedText = null;
        let contentSource = 'none';

        if (fileBuffer) {
          if (mimeType.includes('pdf')) {
            // Versuch 1: PDF-Text extrahieren
            const pdfParse = getPdfParser();
            if (pdfParse) {
              try {
                const parsed = await pdfParse(fileBuffer);
                extractedText = (parsed.text || '').trim().substring(0, 3000);
                if (extractedText.length >= 20) {
                  console.log(`  📄 PDF-Text extrahiert: ${extractedText.length} Zeichen`);
                  contentSource = 'pdf-text';
                } else {
                  console.log(`  📄 PDF enthält kaum Text (${extractedText.length} Zeichen), versuche Vision-Fallback`);
                  extractedText = null;
                }
              } catch (e) {
                console.warn(`  ⚠️ PDF-Text-Extraktion fehlgeschlagen: ${e.message}, versuche Vision-Fallback`);
                warnings.push(`PDF-Text-Extraktion fehlgeschlagen: ${e.message}`);
              }
            } else {
              warnings.push('pdf-parse Bibliothek nicht verfügbar');
            }

            // Versuch 2: PDF als File-Content an die API (Fallback)
            if (!extractedText && fileBuffer.length < 5 * 1024 * 1024) {
              const base64 = fileBuffer.toString('base64');
              contentParts.push({
                type: 'file',
                file: {
                  filename: doc.fileName || 'document.pdf',
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              });
              console.log(`  📎 PDF als File-Content für API vorbereitet (${Math.round(fileBuffer.length / 1024)}KB)`);
              contentSource = 'pdf-file';
            }
          } else if (mimeType.match(/image\/(png|jpe?g|tiff|webp)/)) {
            const base64 = fileBuffer.toString('base64');
            const mediaType = mimeType.includes('png') ? 'image/png' : mimeType.includes('tiff') ? 'image/tiff' : 'image/jpeg';
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'low' },
            });
            console.log(`  🖼️ Bild für Vision-API vorbereitet (${Math.round(fileBuffer.length / 1024)}KB)`);
            contentSource = 'image-vision';
          } else {
            console.warn(`  ⚠️ Unbekannter MIME-Typ: ${mimeType}`);
            warnings.push(`MIME-Typ ${mimeType} wird nicht unterstützt`);
          }
        }

        // ─── 3. LLM-Klassifikation (IMMER versuchen, auch nur mit Dateiname) ───
        const hasContent = extractedText || contentParts.length > 0;
        const classificationPrompt =
          `Du bist ein Dokumenten-Klassifizierer für ein HR-System bei NOVENTIS (Volkswagen-Konzern).\n` +
          `Analysiere die verfügbaren Informationen und ordne das Dokument dem passendsten Typ zu.\n\n` +
          `Verfügbare Dokumenttypen mit Schlüsselwörtern:\n${workflowList}\n\n` +
          `Dateiname: "${doc.fileName}"\n` +
          (userMessage ? `Begleitnachricht des Nutzers: "${userMessage}"\n` : '') +
          (extractedText ? `\nExtrahierter Text aus dem Dokument (Auszug):\n---\n${extractedText}\n---\n` : '') +
          `\nWICHTIG:\n` +
          `- Nutze ALLE verfügbaren Signale: Dateiname, Schlüsselwörter, Nutzer-Nachricht${hasContent ? ', Dokumentinhalt' : ''}.\n` +
          `- "DB" im Dateinamen kann für "Deutsche Bahn" stehen → Fahrkarte / ÖPNV → Fibu24-Nachweis.\n` +
          `- "Nachweis" kann ein Fibu24-Nachweis (Fahrkarte), Arbeitgeberbescheinigung oder anderer Beleg sein.\n` +
          `- Triff deine BESTE Vermutung. Setze confidence entsprechend deiner Sicherheit (0.3 = schwache Vermutung, 0.7+ = sicher).\n` +
          `- Antworte "unbekannt" NUR wenn wirklich GAR KEIN Signal auf einen Typ hindeutet.\n` +
          `\nAntwort-Format (NUR dieses JSON, kein anderer Text):\n` +
          `{\n` +
          `  "documentType": "<exakter Typ aus der Liste oder 'unbekannt'>",\n` +
          `  "label": "<lesbare Bezeichnung>",\n` +
          `  "confidence": <0.0-1.0>,\n` +
          `  "summary": "<1-2 Sätze was das Dokument vermutlich enthält>",\n` +
          `  "detectedFields": ["<erkannte Felder/Infos oder leeres Array>"],\n` +
          `  "intent": "<vermuteter Nutzer-Intent: antrag_einreichen|dokument_pruefen|daten_extrahieren|unklar>"\n` +
          `}`;

        console.log(`  📨 LLM-Klassifikation: Quelle=${contentSource}, hasContent=${hasContent}`);

        let llmResult = null;
        let llmError = null;
        if (openaiClient) {
          const llmMessages = [{
            role: 'user',
            content: contentParts.length > 0
              ? [{ type: 'text', text: classificationPrompt }, ...contentParts]
              : classificationPrompt,
          }];

          const llmParams = {
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: llmMessages,
          };

          try {
            const completion = await openaiClient.chat.completions.create(llmParams);
            const raw = (completion.choices[0]?.message?.content || '').trim();
            if (raw) {
              // JSON aus der Antwort extrahieren (Reasoning-Modelle geben manchmal extra Text zurück)
              const jsonMatch = raw.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                llmResult = JSON.parse(jsonMatch[0]);
                console.log(`  🧠 LLM-Klassifikation: ${llmResult.documentType} (${Math.round((llmResult.confidence || 0) * 100)}%)`);
              } else {
                console.warn(`  ⚠️ LLM-Antwort enthält kein JSON: ${raw.substring(0, 100)}`);
              }
            } else {
              console.warn(`  ⚠️ LLM-Antwort ist leer`);
            }
          } catch (e) {
            // Wenn contentParts den Fehler verursachen (MIME, file-type nicht unterstützt),
            // Retry NUR mit Text-Prompt (Dateiname + User-Nachricht)
            if (contentParts.length > 0 && e.status === 400) {
              console.warn(`  ⚠️ LLM mit Dokumentinhalt fehlgeschlagen (${e.message}), Retry nur mit Dateiname`);
              warnings.push(`Dokumentinhalt konnte nicht an LLM gesendet werden: ${e.message}`);
              contentSource = 'filename-only';
              try {
                const fallbackMessages = [{ role: 'user', content: classificationPrompt }];
                const fallbackCompletion = await openaiClient.chat.completions.create({
                  ...llmParams,
                  messages: fallbackMessages,
                });
                const fallbackRaw = (fallbackCompletion.choices[0]?.message?.content || '').trim();
                if (fallbackRaw) {
                  const jsonMatch = fallbackRaw.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    llmResult = JSON.parse(jsonMatch[0]);
                    console.log(`  🧠 LLM-Klassifikation (Fallback): ${llmResult.documentType} (${Math.round((llmResult.confidence || 0) * 100)}%)`);
                  }
                }
              } catch (e2) {
                llmError = e2.message;
                console.error(`  ❌ LLM-Klassifikation auch ohne Inhalt FEHLGESCHLAGEN: ${e2.message}`);
                warnings.push(`LLM-Analyse fehlgeschlagen: ${e2.message}`);
              }
            } else {
              llmError = e.message;
              console.error(`  ❌ LLM-Klassifikation FEHLGESCHLAGEN: ${e.message}`);
              warnings.push(`LLM-Analyse fehlgeschlagen: ${e.message}`);
            }
          }
        } else {
          console.error('  ❌ OpenAI Client nicht verfügbar!');
          warnings.push('OpenAI Client nicht initialisiert');
        }

        // ─── 4. Ergebnis zusammenbauen (mit Transparenz) ───
        let bestDocType, bestIntent, summary, detectedFields;

        if (llmResult && llmResult.documentType && llmResult.documentType !== 'unbekannt') {
          const matchedWorkflow = availableTypes.find(t =>
            t.documentType === llmResult.documentType ||
            t.label.toLowerCase().includes(llmResult.documentType.toLowerCase())
          );
          bestDocType = {
            documentType: matchedWorkflow?.documentType || llmResult.documentType,
            label: matchedWorkflow?.label || llmResult.label || llmResult.documentType,
            confidence: Math.min(llmResult.confidence || 0.5, 0.95),
            evidence: `KI-Analyse (${contentSource}): ${llmResult.summary || 'Dokument erkannt'}`,
          };
          bestIntent = llmResult.intent && llmResult.intent !== 'unklar'
            ? { intent: llmResult.intent, confidence: 0.6, evidence: 'Aus Dokumentinhalt abgeleitet' }
            : null;
          summary = llmResult.summary;
          detectedFields = llmResult.detectedFields || [];
        } else {
          // Dateiname-Fallback
          const fileNameLower = (doc.fileName || '').toLowerCase();
          for (const wf of availableTypes) {
            const schema = getSchema(wf.documentType);
            if (!schema) continue;
            const matched = schema.triggers.filter(t => fileNameLower.includes(t));
            if (matched.length > 0) {
              bestDocType = { documentType: wf.documentType, label: wf.label, confidence: 0.3, evidence: `Dateiname enthält: ${matched.join(', ')}` };
              break;
            }
          }
          summary = null;
          detectedFields = [];
        }

        const needsUserInput = [];
        if (!bestDocType || bestDocType.confidence < 0.5) needsUserInput.push('documentType');
        if (!bestIntent || bestIntent.confidence < 0.5) needsUserInput.push('intent');

        const analysis = {
          documentId,
          fileName: doc.fileName,
          bestDocType: bestDocType || null,
          bestIntent: bestIntent || null,
          summary,
          detectedFields,
          needsUserInput,
          source: llmResult ? `llm-${contentSource}` : 'filename-heuristic',
          contentSource,
          warnings: warnings.length > 0 ? warnings : undefined,
        };

        // In DB + Audit speichern
        await UPDATE(Documents, documentId).set({
          phase: 'analyzed',
          aiAnalysis: JSON.stringify(analysis),
        });

        if (doc.caseRef_ID) {
          await INSERT.into(CaseEvents).entries({
            caseRef_ID: doc.caseRef_ID,
            eventType: 'ai_analysis',
            payload: JSON.stringify(analysis),
          });
          await UPDATE(Cases, doc.caseRef_ID).set({
            docTypeConfidence: bestDocType?.confidence || 0,
            intentConfidence: bestIntent?.confidence || 0,
            status: needsUserInput.length > 0 ? 'awaiting_input' : 'processing',
          });
        }

        // Empfehlung für den Agent
        let recommendation;
        if (bestDocType && bestDocType.confidence >= 0.7) {
          recommendation = `Dokumenttyp "${bestDocType.label}" erkannt (${Math.round(bestDocType.confidence * 100)}%). ${summary || ''}`;
        } else if (bestDocType) {
          recommendation = `Vermutlich "${bestDocType.label}" (${Math.round(bestDocType.confidence * 100)}%). Bestätigung empfohlen.`;
        } else {
          recommendation = `Dokumenttyp konnte nicht ermittelt werden. Bitte den Nutzer fragen.`;
          if (warnings.length > 0) {
            recommendation += ` Warnungen: ${warnings.join('; ')}`;
          }
        }

        return { analysis, recommendation };
      },
    },

    // ─── Tool 7: Schema-gebundene Extraktion starten (Phase 2) ──
    docai_start_extraction: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_start_extraction',
          description:
            'Startet die schema-gebundene fachliche Extraktion über vw-doc-ai. ' +
            'Verwende dieses Tool ERST, nachdem Dokumenttyp und Nutzer-Intent bestätigt sind. ' +
            'Bindet das passende vw-doc-ai Schema und startet die revisionsfähige Extraktion. ' +
            'WICHTIG: Nur aufrufen wenn der Nutzer den Dokumenttyp bestätigt hat oder die Confidence hoch genug war.',
          parameters: {
            type: 'object',
            properties: {
              documentId: {
                type: 'string',
                description: 'Die UUID des Dokuments',
              },
              documentType: {
                type: 'string',
                description: 'Der bestätigte Dokumenttyp (z.B. "Fibu24-Nachweis", "Elternzeit-Antrag")',
              },
            },
            required: ['documentId', 'documentType'],
          },
        },
      },
      execute: async ({ documentId, documentType }) => {
        const doc = await SELECT.one.from(Documents).where({ ID: documentId });
        if (!doc) return { error: 'Dokument nicht gefunden.' };

        // Bereits extrahiert? → nicht nochmal starten
        if (doc.jobId && (doc.status === 'done' || doc.phase === 'extracted')) {
          return {
            success: true, documentId, documentType: doc.documentType,
            jobId: doc.jobId, status: doc.status,
            message: `Dokument wurde bereits extrahiert (Job: ${doc.jobId}). Rufe docai_get_extraction auf, um die Ergebnisse zu sehen.`,
          };
        }

        const { Cases, CaseEvents, ExtractedFields } = cds.entities('hr.agent');
        const uploadConfig = resolveUploadConfig(documentType);
        const caseId = doc.caseRef_ID;

        // Schema binden
        await UPDATE(Documents, documentId).set({
          documentType,
          schemaId: uploadConfig.schemaId || null,
          phase: 'schema_bound',
          status: 'pending',
        });

        if (caseId) {
          await INSERT.into(CaseEvents).entries({
            caseRef_ID: caseId,
            eventType: 'schema_bound',
            payload: JSON.stringify({ documentId, documentType, schemaId: uploadConfig.schemaId, schemaName: uploadConfig.schemaName }),
          });
        }

        console.log(`🔗 Schema gebunden: Doc ${documentId} → ${documentType} (${uploadConfig.schemaName || 'kein Schema'})`);

        // ─── vw-doc-ai konfiguriert → echten Upload ────────
        const fileBuffer = global._pendingBuffers?.[documentId];
        if (vwDocAi.isConfigured() && fileBuffer) {
          try {
            const uploadOpts = {
              documentType: uploadConfig.documentType,
              ...(uploadConfig.schemaId ? { schemaId: uploadConfig.schemaId } : {}),
              ...(uploadConfig.schemaName ? { schemaName: uploadConfig.schemaName } : {}),
              schemaVersion: 1,
            };

            console.log(`🚀 vw-doc-ai Upload: Schema=${uploadConfig.schemaId || 'keins'}, Type=${uploadConfig.documentType}`);

            const result = await vwDocAi.uploadDocument(
              fileBuffer, doc.fileName, doc.mimeType, uploadOpts,
            );

            await UPDATE(Documents, documentId).set({ jobId: result.id, status: 'pending' });

            if (caseId) {
              await INSERT.into(CaseEvents).entries({
                caseRef_ID: caseId,
                eventType: 'extraction_started',
                payload: JSON.stringify({ documentId, jobId: result.id, schemaName: uploadConfig.schemaName }),
              });
            }

            delete global._pendingBuffers[documentId];

            return {
              success: true, documentId, documentType,
              jobId: result.id, status: 'pending',
              schemaName: uploadConfig.schemaName,
              message: `Extraktion gestartet (Job: ${result.id}). Rufe docai_get_extraction auf, um die Ergebnisse abzurufen.`,
            };
          } catch (vwErr) {
            console.warn(`⚠️ vw-doc-ai nicht erreichbar, Fallback auf Simulation: ${vwErr.message}`);
          }
        }

        // ─── Simulation ───────────────────────────────────
        const simJobId = `sim-${cds.utils.uuid()}`;
        const simResult = getSimulatedExtraction(documentType);
        const simFields = simResult.headerFields || [];

        await UPDATE(Documents, documentId).set({ jobId: simJobId, status: 'done', phase: 'extracted' });

        for (const field of simFields) {
          await INSERT.into(ExtractedFields).entries({
            document_ID: documentId,
            fieldName: field.name,
            fieldValue: field.value,
            confidence: field.confidence,
            rawValue: field.rawValue || field.value,
            page: field.page || 1,
          });
        }

        if (caseId) {
          await INSERT.into(CaseEvents).entries({
            caseRef_ID: caseId,
            eventType: 'extraction_completed',
            payload: JSON.stringify({ documentId, jobId: simJobId, fieldCount: simFields.length, simulated: true }),
          });
        }

        const validation = runCrossValidation(documentType, simFields);
        return {
          success: true, documentId, documentType,
          jobId: simJobId, status: 'done',
          schemaName: uploadConfig.schemaName,
          validation,
          message: `Extraktion abgeschlossen (simuliert). Rufe docai_get_extraction auf, um die Ergebnisse zu sehen.`,
        };
      },
    },

    // ─── Tool 8: Extraktionsergebnis abrufen + Cross-Validation ──
    docai_get_extraction: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_get_extraction',
          description:
            'Ruft die extrahierten Daten eines verarbeiteten Dokuments ab und führt automatisch ' +
            'eine Cross-Validation durch. Verwende dieses Tool, wenn ein Dokument hochgeladen wurde ' +
            'und du die Ergebnisse interpretieren, prüfen oder einen HR-Prozess daraus ableiten möchtest. ' +
            'Liefert: extrahierte Felder, Konfidenzwerte, Cross-Validation (Plausibilität) und ' +
            'Hinweise für die Business-Validation (was gegen HCM geprüft werden sollte).',
          parameters: {
            type: 'object',
            properties: {
              documentId: {
                type: 'string',
                description: 'Die UUID des Dokuments (wird nach dem Upload zurückgegeben).',
              },
            },
            required: ['documentId'],
          },
        },
      },
      execute: async ({ documentId }) => {
        const doc = await SELECT.one.from(Documents).where({ ID: documentId });
        if (!doc) return { found: false, message: 'Dokument nicht gefunden.' };

        const workflow = getSchema(doc.documentType);

        // Wenn vw-doc-ai konfiguriert UND echte (nicht-simulierte) JobId → von dort holen
        const isRealJob = doc.jobId && !doc.jobId.startsWith('sim-');
        if (vwDocAi.isConfigured() && isRealJob) {
          try {
            // Eingebautes Polling: bis zu 4 Versuche mit steigenden Wartezeiten
            const pollDelays = [0, 4000, 5000, 6000];
            for (let attempt = 0; attempt < pollDelays.length; attempt++) {
              if (pollDelays[attempt] > 0) {
                console.log(`  ⏳ Warte ${pollDelays[attempt]/1000}s auf Extraktion (Versuch ${attempt + 1}/${pollDelays.length})...`);
                await new Promise(resolve => setTimeout(resolve, pollDelays[attempt]));
              }

              const job = await vwDocAi.getJobStatus(doc.jobId);

              if (job.status === 'DONE' && job.extraction) {
                const fields = job.extraction.headerFields || [];

                // Felder in lokale DB speichern für spätere Zugriffe
                const { ExtractedFields: EF } = cds.entities('hr.agent');
                const existingFields = await SELECT.from(EF).where({ document_ID: documentId });
                if (existingFields.length === 0 && fields.length > 0) {
                  for (const field of fields) {
                    await INSERT.into(EF).entries({
                      document_ID: documentId,
                      fieldName: field.name,
                      fieldValue: field.value,
                      confidence: field.confidence || 0.9,
                      rawValue: field.rawValue || field.value,
                      page: field.page || 1,
                    });
                  }
                  await UPDATE(Documents, documentId).set({ status: 'done', phase: 'extracted' });
                }

                const crossValidation = runCrossValidation(doc.documentType, fields);
                return {
                  found: true,
                  source: 'vw-doc-ai',
                  status: 'done',
                  documentType: doc.documentType,
                  document: { id: doc.ID, fileName: doc.fileName, documentType: doc.documentType, status: 'done' },
                  extractedFields: fields.map(f => ({
                    fieldName: f.name, fieldValue: f.value,
                    confidence: f.confidence, rawValue: f.rawValue, page: f.page,
                  })),
                  crossValidation,
                  workflowContext: workflow ? {
                    employeeField: workflow.employeeField,
                    hcmAction: workflow.hcmAction,
                    businessChecks: workflow.businessContext,
                  } : null,
                };
              }

              if (job.status === 'FAILED') {
                return { found: true, status: 'failed', message: `Extraktion fehlgeschlagen: ${job.error || 'Unbekannter Fehler'}` };
              }

              // Noch PENDING/PROCESSING → weiter pollen
            }

            // Nach allen Versuchen immer noch nicht DONE
            return { found: true, status: 'processing', message: 'Extraktion läuft noch. Bitte in einigen Sekunden erneut versuchen.' };
          } catch (err) {
            console.warn(`⚠️ vw-doc-ai getJobStatus fehlgeschlagen, Fallback auf lokale DB: ${err.message}`);
            // Fallthrough zur lokalen DB
          }
        }

        // Lokale DB (Simulation oder vw-doc-ai Fallback)
        const fields = await SELECT.from(ExtractedFields).where({ document_ID: documentId });
        const crossValidation = runCrossValidation(doc.documentType, fields);

        return {
          found: true,
          source: 'simulation',
          status: doc.status || 'done',
          documentType: doc.documentType,
          document: { id: doc.ID, fileName: doc.fileName, documentType: doc.documentType, status: doc.status },
          extractedFields: fields.map(f => ({
            fieldName: f.fieldName, fieldValue: f.fieldValue,
            confidence: f.confidence, rawValue: f.rawValue, page: f.page,
          })),
          crossValidation,
          workflowContext: workflow ? {
            employeeField: workflow.employeeField,
            hcmAction: workflow.hcmAction,
            businessChecks: workflow.businessContext,
          } : null,
        };
      },
    },

    // ─── Tool 7: vw-doc-ai Status prüfen ────────────────
    docai_check_status: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_check_status',
          description: 'Prüft, ob der vw-doc-ai Dokumentenverarbeitungsdienst verfügbar ist.',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: async () => {
        if (vwDocAi.isConfigured()) {
          try {
            const health = await vwDocAi.healthCheck();
            return { available: true, configured: true, ...health };
          } catch (err) {
            return { available: false, configured: true, error: err.message };
          }
        }
        return { available: false, configured: false, message: 'vw-doc-ai nicht konfiguriert – Simulationsmodus aktiv.' };
      },
    },

    // ─── Tool 8: Verfügbare Dokumenttypen auflisten ──────
    docai_list_document_types: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_list_document_types',
          description:
            'Listet alle Dokumenttypen auf, die der HR-Agent verarbeiten kann. ' +
            'Zeigt für jeden Typ ob ein vw-doc-ai Schema konfiguriert ist und welche ' +
            'Business-Checks der Agent durchführen kann.',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: async () => {
        const types = listSchemas();
        return {
          documentTypes: types.map(t => {
            const schema = getSchema(t.documentType);
            return {
              ...t,
              businessChecks: schema?.businessContext || [],
            };
          }),
          hint: 'Bei Upload wird der Dokumenttyp automatisch aus dem Dateinamen erkannt. ' +
            'Jeder Typ hat ein zugehöriges vw-doc-ai Schema, employeeField (für HCM-Abgleich) und eine hcmAction (Folge-Aktion).',
        };
      },
    },

    // ─── Tool 9: vw-doc-ai Schemas abrufen ───────────────
    docai_list_schemas: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_list_schemas',
          description:
            'Listet die in vw-doc-ai konfigurierten Extraktions-Schemas auf. ' +
            'Verwende dieses Tool, um zu prüfen welche Schemas verfügbar sind.',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: async () => {
        if (!vwDocAi.isConfigured()) {
          return { configured: false, message: 'vw-doc-ai nicht konfiguriert. Im Simulationsmodus werden vordefinierte Felder verwendet.' };
        }
        try {
          const result = await vwDocAi.listSchemas();
          return { configured: true, schemas: result.schemas || [] };
        } catch (err) {
          return { error: `Fehler beim Abrufen der Schemas: ${err.message}` };
        }
      },
    },

    // ─── Tool 10: Bisherige Extraktionen auflisten ───────
    docai_list_extractions: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_list_extractions',
          description: 'Listet die letzten 10 Dokumentenextraktionen auf (Dateiname, Typ, Status).',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: async () => {
        const docs = await SELECT.from(Documents).orderBy('createdAt desc').limit(10);
        if (docs.length === 0) return { documents: [], message: 'Keine Dokumente vorhanden.' };

        return {
          documents: docs.map(d => ({
            documentId: d.ID,
            fileName: d.fileName,
            documentType: d.documentType,
            status: d.status,
            createdAt: d.createdAt,
          })),
        };
      },
    },

    // ─── Tool 11: Dokument genehmigen/ablehnen ───────────
    docai_review: {
      definition: {
        type: 'function',
        function: {
          name: 'docai_review',
          description:
            'Genehmigt oder lehnt ein Extraktionsergebnis in vw-doc-ai ab (Human-in-the-Loop). ' +
            'Verwende dieses Tool nachdem der Benutzer die extrahierten Daten geprüft und bestätigt hat.',
          parameters: {
            type: 'object',
            properties: {
              documentId: {
                type: 'string',
                description: 'UUID des Dokuments',
              },
              action: {
                type: 'string',
                enum: ['approve', 'reject'],
                description: 'Genehmigen oder Ablehnen',
              },
              comment: {
                type: 'string',
                description: 'Optionaler Kommentar zur Entscheidung',
              },
            },
            required: ['documentId', 'action'],
          },
        },
      },
      execute: async ({ documentId, action, comment }) => {
        const doc = await SELECT.one.from(Documents).where({ ID: documentId });
        if (!doc) return { error: 'Dokument nicht gefunden.' };

        if (!vwDocAi.isConfigured() || !doc.jobId) {
          // Simulation: lokalen Status setzen
          const newStatus = action === 'approve' ? 'approved' : 'rejected';
          await UPDATE(Documents, documentId).set({ status: newStatus });
          return { success: true, action, status: newStatus, message: `Dokument ${action === 'approve' ? 'genehmigt' : 'abgelehnt'} (simuliert).` };
        }

        try {
          if (action === 'approve') {
            await vwDocAi.approveJob(doc.jobId, comment);
          } else {
            await vwDocAi.rejectJob(doc.jobId, comment);
          }
          const newStatus = action === 'approve' ? 'approved' : 'rejected';
          await UPDATE(Documents, documentId).set({ status: newStatus });
          return { success: true, action, status: newStatus };
        } catch (err) {
          return { error: `Review-Fehler: ${err.message}` };
        }
      },
    },
  };

  return tools;
}

/**
 * Gibt die OpenAI Function-Calling Tool-Definitionen zurück.
 */
function getToolDefinitions(tools) {
  return Object.values(tools).map(t => t.definition);
}

/**
 * Führt einen Tool-Call aus.
 */
async function executeTool(tools, toolName, args) {
  const tool = tools[toolName];
  if (!tool) {
    return { error: `Unbekanntes Tool: ${toolName}` };
  }
  try {
    return await tool.execute(args);
  } catch (err) {
    return { error: `Tool-Fehler (${toolName}): ${err.message}` };
  }
}

module.exports = { createTools, getToolDefinitions, executeTool };
