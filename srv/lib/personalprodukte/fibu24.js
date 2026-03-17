/**
 * Personalprodukt: Fibu24-Nachweis (Fahrkarten-Erstattung)
 *
 * Jedes Personalprodukt definiert ALLES, was der Agent für diesen
 * Prozess wissen muss:
 *   - Erkennung (Trigger-Keywords)
 *   - vw-doc-ai Konfiguration (Schema, Felder)
 *   - Mitarbeiter-Identifikation (welches Feld → HCM-Lookup)
 *   - HCM-Aktion (Typ, Feld-Mapping)
 *   - Pflichtfelder + Rückfrage-Texte
 *   - Cross-Validierung (deterministische Prüfungen)
 *   - Antwort-Templates (standardisierte Responses)
 *   - Simulierte Daten (Dev/Demo-Modus)
 */

module.exports = {
  id: 'fibu24',
  label: 'Fibu24-Nachweis (Fahrkarten-Erstattung)',
  description: 'Erstattung von Fahrtkosten für Jobticket, Deutschlandticket, Monatsabo',

  // ─── Erkennung ────────────────────────────────────────
  triggers: [
    'fibu24', 'fahrkarte', 'monatsabo', 'abo-nachweis', 'jobticket',
    'deutschlandticket', 'abo', 'öpnv', 'pendlernachweis', 'monatsticket',
    'nahverkehr', 'bahncard', 'ticket', 'monatskarte', 'zeitkarte',
    'db', 'bahn',
  ],

  // ─── vw-doc-ai Konfiguration ──────────────────────────
  docai: {
    schemaName: 'Fibu24_Schema',
    schemaId: '60ae4d9b-ea85-4490-be80-0478700cd254',
    documentType: 'custom',
  },

  // ─── Mitarbeiter-Identifikation ───────────────────────
  employee: {
    lookupField: 'Nachname',    // Welches extrahierte Feld
    lookupType: 'lastName',     // 'lastName' | 'personnelNumber'
  },

  // ─── HCM-Aktion ──────────────────────────────────────
  hcmAction: 'fibu24_erstattung',

  // ─── Pflichtfelder + Rückfrage-Regeln ─────────────────
  // Wenn ein Feld nach der Extraktion fehlt, wird der User gefragt.
  requiredFields: [
    { field: 'Vorname',           prompt: 'Wie lautet der **Vorname** des Fahrkarten-Inhabers?' },
    { field: 'Nachname',          prompt: 'Wie lautet der **Nachname** des Fahrkarten-Inhabers?' },
    { field: 'Gültig ab Datum',   prompt: 'Ab wann ist die Fahrkarte **gültig** (Datum)?' },
    { field: 'Gültig bis Datum',  prompt: 'Bis wann ist die Fahrkarte **gültig** (Datum)?' },
  ],

  // ─── Cross-Validierung ────────────────────────────────
  // Deterministische Plausibilitätsprüfung NACH Extraktion.
  validation(fields) {
    const issues = [];
    const valid = [];
    const map = {};
    for (const f of fields) { map[f.fieldName || f.name] = f.fieldValue || f.value; }

    const von = map['Gültig ab Datum'];
    const bis = map['Gültig bis Datum'];
    if (von && bis) {
      const vonD = new Date(von);
      const bisD = new Date(bis);
      if (!isNaN(vonD) && !isNaN(bisD)) {
        if (vonD > bisD) {
          issues.push('Gültigkeit-Von liegt nach Gültigkeit-Bis');
        } else {
          const days = Math.round((bisD - vonD) / (1000 * 60 * 60 * 24));
          valid.push(`Gültigkeitszeitraum: ${days} Tage`);
          if (days > 366) issues.push('Gültigkeitszeitraum über 1 Jahr – ungewöhnlich');
        }
      }
    }

    if (map.Vorname && map.Nachname) {
      valid.push(`Inhaber: ${map.Vorname} ${map.Nachname}`);
    } else if (!map.Vorname && !map.Nachname) {
      issues.push('Kein Name des Inhabers extrahiert');
    }

    return { issues, valid };
  },

  // ─── Business-Checks (Info für Validierung) ──────────
  businessChecks: [
    'Name auf Fahrkarte stimmt mit Mitarbeiter überein',
    'Fibu24-Erstattungsanspruch besteht (berechtigte Mitarbeitergruppe)',
    'Zeitraum fällt in den aktuellen Abrechnungsmonat',
    'Kein doppelter Nachweis für denselben Zeitraum',
  ],

  // ─── Antwort-Templates ────────────────────────────────
  // Jede Stelle im Workflow, an der der User eine Antwort bekommt,
  // hat ein festes Template. KEIN LLM-generierter Text.
  templates: {

    // Phase 1: Hypothese präsentieren
    hypothesis(ctx) {
      const conf = ctx.analysis?.bestDocType?.confidence || 0;
      if (conf >= 0.6) {
        return {
          text: 'Das sieht nach einem **Fibu24-Nachweis** (Fahrkarte/ÖPNV-Abo) aus. Soll ich die Daten extrahieren und die Erstattung vorbereiten?',
          suggestions: ['Ja, Erstattung vorbereiten', 'Nur Daten prüfen', 'Anderer Dokumenttyp'],
        };
      }
      return {
        text: 'Das könnte ein **Fibu24-Nachweis** sein, aber ich bin mir nicht ganz sicher. Können Sie bestätigen, um welchen Dokumenttyp es sich handelt?',
        suggestions: ['Ja, Fibu24-Nachweis', 'Anderer Dokumenttyp', 'Abbrechen'],
      };
    },

    // Phase 2-5: Zusammenfassung nach Extraktion + Validierung
    extractionSummary(ctx) {
      const fields = ctx.extraction?.extractedFields || [];
      const employee = ctx.employee;
      const val = ctx.validationResult || { issues: [], valid: [] };

      const fieldLines = fields
        .map(f => `- **${f.fieldName}:** ${f.fieldValue}`)
        .join('\n');

      let validationText;
      if (val.issues.length === 0) {
        validationText = 'Alle Prüfungen bestanden.';
        if (employee) {
          validationText += ` Die Daten stimmen mit dem Mitarbeiterprofil von **${employee.firstName} ${employee.lastName}** (${employee.personnelNumber}) überein.`;
        }
      } else {
        validationText = `Hinweise: ${val.issues.join(', ')}.`;
        if (val.valid.length > 0) {
          validationText += ` Bestanden: ${val.valid.join(', ')}.`;
        }
      }

      return {
        text: `Ich habe Ihren **Fibu24-Nachweis** verarbeitet und die Daten geprüft:\n\n${fieldLines}\n\n${validationText}\n\nSoll ich die **Fibu24-Erstattung** jetzt einreichen?`,
        suggestions: ['Ja, Erstattung einreichen', 'Daten korrigieren', 'Abbrechen'],
      };
    },

    // Felder fehlen → Rückfrage
    missingFields(missingList) {
      const prompts = missingList.map(m => `- ${m.prompt}`).join('\n');
      return {
        text: `Mir fehlen noch Informationen zum Fibu24-Nachweis:\n\n${prompts}`,
        suggestions: missingList.slice(0, 3).map(m => m.field),
      };
    },

    // Extraktion fertig, aber kein MA gefunden
    employeeNotFound(ctx) {
      const nameField = (ctx.extraction?.extractedFields || [])
        .find(f => /nachname/i.test(f.fieldName));
      const hint = nameField
        ? `Ich konnte **${nameField.fieldValue}** im Dokument erkennen, aber keinen Mitarbeiter zuordnen.`
        : 'Ich konnte keinen Mitarbeiternamen im Dokument erkennen.';
      return {
        text: `${hint} Wie lautet die Personalnummer des betroffenen Mitarbeiters?`,
        suggestions: ['Personalnummer eingeben', 'Abbrechen'],
      };
    },

    // Phase 6: Einreichung erfolgreich
    submitted() {
      return {
        text: 'Die **Fibu24-Erstattung** wurde erfolgreich eingereicht. ✓\n\nDer Vorgang wird jetzt im SAP HCM System bearbeitet.\n\nKann ich Ihnen bei etwas anderem helfen?',
        suggestions: ['Neues Dokument hochladen', 'Frage zu HR-Themen', 'Fertig'],
      };
    },

    // Validierung fehlgeschlagen
    validationFailed(issues) {
      return {
        text: `Die Validierung hat Probleme ergeben:\n\n${issues.map(i => `- ${i}`).join('\n')}\n\nBitte prüfen Sie die Angaben.`,
        suggestions: ['Daten korrigieren', 'Trotzdem einreichen', 'Abbrechen'],
      };
    },
  },

  // ─── Simulierte Extraktion (Dev/Demo) ─────────────────
  simulatedExtraction: {
    headerFields: [
      { name: 'Vorname',           value: 'Andrea',       confidence: 0.94, page: 1 },
      { name: 'Nachname',          value: 'Kirchhoff',    confidence: 0.93, page: 1 },
      { name: 'Gültig ab Datum',   value: '2023-01-01',   confidence: 0.96, page: 1 },
      { name: 'Gültig bis Datum',  value: '2023-12-31',   confidence: 0.95, page: 1 },
    ],
    lineItems: [],
  },
};
