/**
 * Document Workflow Registry
 *
 * Zentraler Konfigurationspunkt für alle Dokumenten-Workflows.
 * Um einen neuen Personalprozess hinzuzufügen, genügt ein neuer Eintrag hier.
 *
 * Jeder Workflow definiert:
 *   - triggers:            Keywords für Auto-Erkennung (Dateiname + Chat-Kontext)
 *   - vwDocAi:             Schema-Mapping für vw-doc-ai (schemaName, documentType)
 *   - schemaId:            UUID aus vw-doc-ai (null = dynamisch auflösen oder Simulation)
 *   - employeeField:       Welches extrahierte Feld den Mitarbeiter identifiziert
 *   - hcmAction:           Welche HCM-Aktion nach Freigabe ausgelöst wird
 *   - crossValidation:     Deterministische Plausibilitätsprüfung NACH Extraktion
 *   - businessContext:     Was der Agent gegen HCM prüfen soll
 *   - simulatedExtraction: Demo-Daten wenn vw-doc-ai nicht konfiguriert ist
 */

// ─── Hilfsfunktionen ────────────────────────────────────

function toFieldMap(fields) {
  const map = {};
  for (const f of fields) {
    map[f.name || f.fieldName] = f.value || f.fieldValue;
  }
  return map;
}

function parseCurrency(val) {
  return parseFloat(String(val).replace(/[^0-9.,\-]/g, '').replace(',', '.'));
}

// ─── Workflow-Registry ──────────────────────────────────

const DOCUMENT_WORKFLOWS = {

  // ═══════════════════════════════════════════════════════
  // Fibu24-Nachweis (Fahrkarte / ÖPNV-Abo)
  // ═══════════════════════════════════════════════════════
  'Fibu24-Nachweis': {
    label: 'Fibu24-Nachweis (Fahrkarte / ÖPNV-Abo)',

    triggers: [
      'fibu24', 'fahrkarte', 'monatsabo', 'abo-nachweis', 'jobticket',
      'deutschlandticket', 'abo', 'öpnv', 'pendlernachweis', 'monatsticket',
      'nahverkehr', 'bahncard', 'ticket', 'monatskarte', 'zeitkarte',
      'db', 'bahn',
    ],

    vwDocAi: {
      schemaName: 'Fibu24_Schema',
      documentType: 'custom',
    },

    schemaId: '60ae4d9b-ea85-4490-be80-0478700cd254',
    documentType: 'fibu24_nachweis',
    employeeField: 'Vorname',
    hcmAction: 'fibu24_erstattung',

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      // Real vw-doc-ai fields: Vorname, Nachname, Gültig ab Datum, Gültig bis Datum
      const von = map['Gültig ab Datum'];
      const bis = map['Gültig bis Datum'];
      if (von && bis) {
        const vonDate = new Date(von);
        const bisDate = new Date(bis);
        if (!isNaN(vonDate.getTime()) && !isNaN(bisDate.getTime())) {
          if (vonDate > bisDate) {
            issues.push('Gültigkeit-Von liegt nach Gültigkeit-Bis');
          } else {
            const days = Math.round((bisDate - vonDate) / (1000 * 60 * 60 * 24));
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

    businessContext: [
      'Name auf Fahrkarte stimmt mit Mitarbeiter überein (Personalnummer prüfen)',
      'Fibu24-Erstattungsanspruch besteht (Mitarbeiter in berechtigter Mitarbeitergruppe)',
      'Strecke entspricht dem Arbeitsweg (Wohnadresse ↔ Arbeitsort)',
      'Betrag innerhalb der monatlichen Erstattungsgrenzen',
      'Zeitraum fällt in den aktuellen Abrechnungsmonat',
      'Kein doppelter Nachweis für denselben Zeitraum eingereicht',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Vorname',           label: 'Vorname',    value: 'Andrea',       rawValue: 'Andrea',       type: 'string', confidence: 0.94, page: 1 },
        { name: 'Nachname',          label: 'Nachname',   value: 'Kirchhoff',    rawValue: 'Kirchhoff',    type: 'string', confidence: 0.93, page: 1 },
        { name: 'Gültig ab Datum',   label: 'Gültig ab',  value: '2023-01-01',   rawValue: '01.01.23',     type: 'date',   confidence: 0.96, page: 1 },
        { name: 'Gültig bis Datum',  label: 'Gültig bis', value: '2023-12-31',   rawValue: '31.12.23',     type: 'date',   confidence: 0.95, page: 1 },
      ],
      lineItems: [],
    },
  },

  // ═══════════════════════════════════════════════════════
  // Elternzeit-Antrag
  // ═══════════════════════════════════════════════════════
  'Elternzeit-Antrag': {
    label: 'Elternzeit-Antrag',

    triggers: [
      'elternzeit', 'parental', 'elterngeld', 'mutterschutz',
      'erziehungsurlaub', 'elternantrag',
    ],

    vwDocAi: {
      schemaName: 'Elternzeit-Antrag',
      documentType: 'custom',
    },

    schemaId: null,
    documentType: 'elternzeit_antrag',
    employeeField: 'Antragsteller',
    hcmAction: 'elternzeit',

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      if (map.Beginn_Elternzeit && map.Ende_Elternzeit) {
        const begin = new Date(map.Beginn_Elternzeit);
        const end = new Date(map.Ende_Elternzeit);
        if (begin >= end) {
          issues.push('Beginn der Elternzeit muss vor dem Ende liegen');
        } else {
          const months = (end.getTime() - begin.getTime()) / (1000 * 60 * 60 * 24 * 30);
          valid.push(`Elternzeit-Zeitraum: ca. ${Math.round(months)} Monate`);
          if (months > 36) issues.push('Elternzeit darf maximal 36 Monate betragen');
        }
      }

      if (map.Kind_Geburtsdatum && map.Beginn_Elternzeit) {
        if (new Date(map.Kind_Geburtsdatum) > new Date(map.Beginn_Elternzeit)) {
          issues.push('Kind-Geburtsdatum liegt nach dem Elternzeit-Beginn – bitte prüfen');
        } else {
          valid.push('Geburtsdatum des Kindes liegt vor Elternzeit-Beginn');
        }
      }

      return { issues, valid };
    },

    businessContext: [
      'Antragsteller ist im HCM als aktiver Mitarbeiter geführt',
      'Keine überlappende Abwesenheit im Zeitraum',
      'Gesetzliche Fristen eingehalten (7 Wochen vor Beginn)',
      'Restliche Elternzeit-Monate verfügbar (max. 36)',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Antragsteller',     label: 'Antragsteller',             value: 'Max Mustermann', rawValue: 'Max Mustermann', type: 'string', confidence: 0.96, page: 1 },
        { name: 'Personalnummer',    label: 'Personalnummer',            value: '00012345',       rawValue: '00012345',       type: 'string', confidence: 0.88, page: 1 },
        { name: 'Beginn_Elternzeit', label: 'Beginn Elternzeit',         value: '2026-06-01',     rawValue: '01.06.2026',     type: 'date',   confidence: 0.93, page: 1 },
        { name: 'Ende_Elternzeit',   label: 'Ende Elternzeit',           value: '2027-05-31',     rawValue: '31.05.2027',     type: 'date',   confidence: 0.91, page: 1 },
        { name: 'Kind_Geburtsdatum', label: 'Geburtsdatum d. Kindes',    value: '2026-05-15',     rawValue: '15.05.2026',     type: 'date',   confidence: 0.94, page: 1 },
      ],
      lineItems: [],
    },
  },

  // ═══════════════════════════════════════════════════════
  // Arbeitsvertrag
  // ═══════════════════════════════════════════════════════
  'Arbeitsvertrag': {
    label: 'Arbeitsvertrag',

    triggers: [
      'vertrag', 'contract', 'arbeitsvertrag', 'dienstvertrag',
      'anstellungsvertrag', 'einstellung',
    ],

    vwDocAi: {
      schemaName: 'Arbeitsvertrag',
      documentType: 'custom',
    },

    schemaId: null,
    documentType: 'arbeitsvertrag',
    employeeField: 'Arbeitnehmer_Name',
    hcmAction: null,

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      if (map.Wochenarbeitszeit) {
        const hours = parseFloat(map.Wochenarbeitszeit);
        if (isNaN(hours) || hours < 5 || hours > 48) {
          issues.push(`Wochenarbeitszeit ${hours}h unplausibel (erwartet: 5-48h)`);
        } else {
          valid.push(`Wochenarbeitszeit ${hours}h plausibel`);
        }
      }

      return { issues, valid };
    },

    businessContext: [
      'Mitarbeiter noch nicht im System angelegt (Neueinstellung)',
      'Kostenstelle existiert und ist aktiv',
      'Entgeltgruppe entspricht Tarifvertrag',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Arbeitnehmer_Name', label: 'Arbeitnehmer',      value: 'Max Mustermann', rawValue: 'Max Mustermann', type: 'string', confidence: 0.95, page: 1 },
        { name: 'Eintrittsdatum',    label: 'Eintrittsdatum',     value: '2024-01-15',     rawValue: '15.01.2024',     type: 'date',   confidence: 0.92, page: 1 },
        { name: 'Wochenarbeitszeit', label: 'Wochenstunden',      value: '40',              rawValue: '40 Stunden',     type: 'number', confidence: 0.98, page: 1 },
        { name: 'Entgeltgruppe',     label: 'Entgeltgruppe',      value: 'E12',             rawValue: 'E12',            type: 'string', confidence: 0.88, page: 2 },
        { name: 'Kostenstelle',      label: 'Kostenstelle',       value: '4711',            rawValue: '4711',           type: 'string', confidence: 0.91, page: 2 },
      ],
      lineItems: [],
    },
  },

  // ═══════════════════════════════════════════════════════
  // Gehaltsabrechnung
  // ═══════════════════════════════════════════════════════
  'Gehaltsabrechnung': {
    label: 'Gehaltsabrechnung',

    triggers: [
      'gehalt', 'abrechnung', 'payslip', 'lohnabrechnung',
      'gehaltsnachweis', 'verdienstbescheinigung', 'entgelt',
    ],

    vwDocAi: {
      schemaName: 'Gehaltsabrechnung',
      documentType: 'custom',
    },

    schemaId: null,
    documentType: 'gehaltsabrechnung',
    employeeField: 'Mitarbeiter_Name',
    hcmAction: null,

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      if (map.Brutto && map.Netto) {
        const brutto = parseCurrency(map.Brutto);
        const netto = parseCurrency(map.Netto);
        if (!isNaN(brutto) && !isNaN(netto)) {
          if (netto > brutto) {
            issues.push('Netto ist höher als Brutto – Daten prüfen');
          } else {
            valid.push(`Brutto/Netto-Verhältnis: ${Math.round((netto / brutto) * 100)}% – plausibel`);
          }
        }
      }

      return { issues, valid };
    },

    businessContext: [
      'Bruttobetrag stimmt mit Vertragsdaten überein',
      'Steuerklasse korrekt hinterlegt',
      'Abzüge plausibel für die Steuerklasse',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Mitarbeiter_Name', label: 'Mitarbeiter',       value: 'Max Mustermann', rawValue: 'Max Mustermann', type: 'string', confidence: 0.96, page: 1 },
        { name: 'Personalnummer',   label: 'Personalnummer',    value: '00012345',       rawValue: '00012345',       type: 'string', confidence: 0.92, page: 1 },
        { name: 'Abrechnungsmonat', label: 'Abrechnungsmonat',  value: '01/2026',        rawValue: 'Januar 2026',    type: 'string', confidence: 0.94, page: 1 },
        { name: 'Brutto',           label: 'Bruttogehalt',      value: '4850.00',        rawValue: '4.850,00 €',     type: 'amount', confidence: 0.97, page: 1 },
        { name: 'Netto',            label: 'Nettogehalt',       value: '3012.45',        rawValue: '3.012,45 €',     type: 'amount', confidence: 0.95, page: 1 },
        { name: 'Steuerklasse',     label: 'Steuerklasse',      value: '1',              rawValue: 'I',              type: 'string', confidence: 0.89, page: 1 },
      ],
      lineItems: [],
    },
  },

  // ═══════════════════════════════════════════════════════
  // Krankmeldung / AU-Bescheinigung
  // ═══════════════════════════════════════════════════════
  'Krankmeldung': {
    label: 'Krankmeldung / AU-Bescheinigung',

    triggers: [
      'krank', 'au-bescheinigung', 'arbeitsunfähig', 'krankmeldung',
      'krankschreibung', 'attest', 'arztbescheinigung',
    ],

    vwDocAi: {
      schemaName: 'Krankmeldung',
      documentType: 'custom',
    },

    schemaId: null,
    documentType: 'krankmeldung',
    employeeField: 'Patient_Name',
    hcmAction: 'krankmeldung',

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      if (map.AU_Beginn && map.AU_Ende) {
        const begin = new Date(map.AU_Beginn);
        const end = new Date(map.AU_Ende);
        if (begin > end) {
          issues.push('AU-Beginn liegt nach AU-Ende');
        } else {
          const days = Math.round((end - begin) / (1000 * 60 * 60 * 24)) + 1;
          valid.push(`AU-Zeitraum: ${days} Tag(e)`);
          if (days > 42) issues.push('AU länger als 6 Wochen – Krankengeld-Prüfung erforderlich');
        }
      }

      return { issues, valid };
    },

    businessContext: [
      'Patient stimmt mit Mitarbeiter überein',
      'Keine Überlappung mit Urlaub oder anderer Abwesenheit',
      'Bei Folgebescheinigung: Anschluss an vorherige AU prüfen',
      'Lohnfortzahlungsanspruch prüfen (6-Wochen-Grenze)',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Patient_Name',      label: 'Patient',                     value: 'Max Mustermann',    rawValue: 'Max Mustermann',    type: 'string', confidence: 0.93, page: 1 },
        { name: 'AU_Beginn',         label: 'AU-Beginn',                   value: '2026-03-10',        rawValue: '10.03.2026',        type: 'date',   confidence: 0.95, page: 1 },
        { name: 'AU_Ende',           label: 'AU-Ende',                     value: '2026-03-14',        rawValue: '14.03.2026',        type: 'date',   confidence: 0.92, page: 1 },
        { name: 'Erstbescheinigung', label: 'Erst-/Folgebescheinigung',    value: 'Erstbescheinigung', rawValue: 'Erstbescheinigung', type: 'string', confidence: 0.87, page: 1 },
        { name: 'Arzt_Name',         label: 'Arzt',                        value: 'Dr. med. Schmidt',  rawValue: 'Dr. med. Schmidt',  type: 'string', confidence: 0.80, page: 1 },
      ],
      lineItems: [],
    },
  },

  // ═══════════════════════════════════════════════════════
  // Reisekostenabrechnung
  // ═══════════════════════════════════════════════════════
  'Reisekostenabrechnung': {
    label: 'Reisekostenabrechnung',

    triggers: [
      'reise', 'travel', 'dienstreise', 'reisekosten',
      'reisekostenabrechnung', 'spesen', 'hotelrechnung',
    ],

    vwDocAi: {
      schemaName: 'Reisekostenabrechnung',
      documentType: 'custom',
    },

    schemaId: null,
    documentType: 'reisekostenabrechnung',
    employeeField: 'Reisender_Name',
    hcmAction: 'reisekostenerstattung',

    crossValidation: (fields) => {
      const issues = [];
      const valid = [];
      const map = toFieldMap(fields);

      if (map.Reise_Beginn && map.Reise_Ende) {
        const begin = new Date(map.Reise_Beginn);
        const end = new Date(map.Reise_Ende);
        if (begin > end) {
          issues.push('Reisebeginn liegt nach Reiseende');
        } else {
          const days = Math.round((end - begin) / (1000 * 60 * 60 * 24)) + 1;
          valid.push(`Reisedauer: ${days} Tag(e)`);
        }
      }

      if (map.Gesamtbetrag) {
        const amount = parseCurrency(map.Gesamtbetrag);
        if (!isNaN(amount) && amount > 5000) {
          issues.push(`Betrag ${amount.toFixed(2)}€ überschreitet Genehmigungsgrenze`);
        } else if (!isNaN(amount) && amount > 0) {
          valid.push(`Erstattungsbetrag ${amount.toFixed(2)}€ im Rahmen`);
        }
      }

      return { issues, valid };
    },

    businessContext: [
      'Reisender ist aktiver Mitarbeiter',
      'Dienstreise war genehmigt',
      'Kostenstelle ist berechtigt',
      'Beträge innerhalb der Reisekostenrichtlinie',
    ],

    simulatedExtraction: {
      headerFields: [
        { name: 'Reisender_Name', label: 'Reisender',         value: 'Max Mustermann', rawValue: 'Max Mustermann', type: 'string', confidence: 0.94, page: 1 },
        { name: 'Reiseziel',      label: 'Reiseziel',         value: 'München',        rawValue: 'München',        type: 'string', confidence: 0.92, page: 1 },
        { name: 'Reise_Beginn',   label: 'Reisebeginn',       value: '2026-02-20',     rawValue: '20.02.2026',     type: 'date',   confidence: 0.96, page: 1 },
        { name: 'Reise_Ende',     label: 'Reiseende',         value: '2026-02-22',     rawValue: '22.02.2026',     type: 'date',   confidence: 0.95, page: 1 },
        { name: 'Gesamtbetrag',   label: 'Erstattungsbetrag', value: '342.80',         rawValue: '342,80 EUR',     type: 'amount', confidence: 0.88, page: 1 },
        { name: 'Kostenstelle',   label: 'Kostenstelle',      value: '4711',           rawValue: '4711',           type: 'string', confidence: 0.90, page: 1 },
      ],
      lineItems: [],
    },
  },
};

// ─── Public API ─────────────────────────────────────────

/**
 * Gibt die Workflow-Config für einen Dokumenttyp zurück.
 * Akzeptiert sowohl den Registry-Key (z.B. 'Fibu24-Nachweis') als auch
 * den internen documentType (z.B. 'fibu24_nachweis').
 */
function getSchema(documentType) {
  if (DOCUMENT_WORKFLOWS[documentType]) return DOCUMENT_WORKFLOWS[documentType];

  for (const wf of Object.values(DOCUMENT_WORKFLOWS)) {
    if (wf.documentType === documentType) return wf;
  }
  return null;
}

/** Listet alle registrierten Workflows mit Metadaten */
function listSchemas() {
  return Object.entries(DOCUMENT_WORKFLOWS).map(([key, wf]) => ({
    documentType: key,
    label: wf.label,
    schemaId: wf.schemaId,
    vwDocAiSchemaName: wf.vwDocAi.schemaName,
    configured: !!wf.schemaId,
    employeeField: wf.employeeField,
    hcmAction: wf.hcmAction,
    triggers: wf.triggers,
  }));
}

/**
 * Führt die Cross-Validation auf extrahierten Feldern durch.
 */
function runCrossValidation(documentType, fields) {
  const wf = getSchema(documentType);

  const lowConfidence = fields
    .filter(f => (f.confidence ?? 1) < 0.7)
    .map(f => `Feld "${f.name || f.fieldName}" hat niedrige Konfidenz (${Math.round((f.confidence ?? 0) * 100)}%) – manuelle Prüfung empfohlen`);

  if (!wf) {
    return {
      documentType,
      schemaFound: false,
      isValid: lowConfidence.length === 0,
      issues: lowConfidence,
      validChecks: lowConfidence.length === 0
        ? ['Kein spezifisches Schema – nur Konfidenz-Check durchgeführt']
        : [],
      fieldCount: fields.length,
    };
  }

  const { issues, valid } = wf.crossValidation(fields);
  const allIssues = [...lowConfidence, ...issues];

  return {
    documentType,
    schemaFound: true,
    isValid: allIssues.length === 0,
    issues: allIssues,
    validChecks: valid,
    fieldCount: fields.length,
    businessChecks: wf.businessContext,
    employeeField: wf.employeeField,
    hcmAction: wf.hcmAction,
  };
}

/** Gibt simulierte Extraktionsdaten zurück (Dev/Demo) */
function getSimulatedExtraction(documentType) {
  const wf = getSchema(documentType);
  if (wf?.simulatedExtraction) return wf.simulatedExtraction;

  return {
    headerFields: [
      { name: 'Dokumenttyp', label: 'Dokumenttyp', value: documentType || 'Unbekannt', rawValue: documentType, type: 'string', confidence: 0.80, page: 1 },
    ],
    lineItems: [],
  };
}

/**
 * Erkennt den Dokumenttyp aus Dateiname ODER Chat-Kontext.
 * Prüft alle Workflows gegen ihre Trigger-Keywords.
 */
function inferDocumentType(input) {
  const lower = (input || '').toLowerCase();

  for (const [key, wf] of Object.entries(DOCUMENT_WORKFLOWS)) {
    if (wf.triggers.some(t => lower.includes(t))) {
      return key;
    }
  }

  return 'custom';
}

/**
 * Löst den vw-doc-ai-Kontext für einen Upload auf.
 */
function resolveUploadConfig(documentType) {
  const wf = getSchema(documentType);
  if (!wf) {
    return { documentType: 'custom', schemaId: null, schemaName: null };
  }

  return {
    documentType: wf.vwDocAi.documentType,
    schemaId: wf.schemaId,
    schemaName: wf.vwDocAi.schemaName,
  };
}

/**
 * Gibt eine Zusammenfassung aller Workflows zurück (für System-Prompt / Agent-Kontext).
 */
function getWorkflowSummary() {
  return Object.entries(DOCUMENT_WORKFLOWS).map(([key, wf]) => ({
    type: key,
    label: wf.label,
    triggers: wf.triggers.slice(0, 5).join(', '),
    employeeField: wf.employeeField,
    hcmAction: wf.hcmAction,
    businessChecks: wf.businessContext.length,
  }));
}

module.exports = {
  getSchema,
  listSchemas,
  runCrossValidation,
  getSimulatedExtraction,
  inferDocumentType,
  resolveUploadConfig,
  getWorkflowSummary,
  DOCUMENT_WORKFLOWS,
};
