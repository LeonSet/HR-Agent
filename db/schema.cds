namespace hr.agent;

using { cuid, managed } from '@sap/cds/common';

// ─── Chat ───────────────────────────────────────────────
entity ChatSessions : cuid, managed {
  title    : String(200);
  messages : Composition of many ChatMessages on messages.session = $self;
}

entity ChatMessages : cuid, managed {
  session  : Association to ChatSessions;
  role     : String enum { user; assistant; system };
  content  : LargeString;
}

// ─── Cases (Vorgänge) ───────────────────────────────────
// Ein Case bündelt einen HR-Vorgang: Dokumente, Validierungen, HCM-Aktionen
entity Cases : cuid, managed {
  session      : Association to ChatSessions;
  status       : String enum { open; awaiting_input; processing; validated; completed; failed } default 'open';
  // ─── Workflow State (DB-persistent, ersetzt [WORKFLOW_STATE:...] in Chat-Nachrichten) ───
  productId    : String(50);               // Personalprodukt-ID (z.B. 'fibu24')
  workflowState: String(50);              // State-Machine-Zustand (z.B. 'awaiting_confirmation')
  workflowData : LargeString;             // JSON: akkumulierte Workflow-Daten (Extraktion, Employee, etc.)
  // ─── Analyse-Metadaten ───
  documentType : String(100);              // bestätigter Dokumenttyp (null = noch nicht festgelegt)
  intent       : String(100);              // bestätigter Nutzer-Intent (null = noch nicht festgelegt)
  docTypeConfidence  : Decimal(3,2);       // 0.00–1.00, Sicherheit der Typ-Hypothese
  intentConfidence   : Decimal(3,2);       // 0.00–1.00, Sicherheit der Intent-Hypothese
  documents    : Composition of many Documents on documents.caseRef = $self;
  events       : Composition of many CaseEvents  on events.caseRef  = $self;
  hcmActions   : Composition of many HCMActions   on hcmActions.caseRef = $self;
}

// ─── Case Events (Audit Trail) ──────────────────────────
// Jede fachlich relevante Aktion wird als Event protokolliert
entity CaseEvents : cuid, managed {
  caseRef   : Association to Cases;
  eventType : String enum {
    document_uploaded;       // Dokument dem Fall zugeordnet
    ai_analysis;             // Generische LLM-Analyse (Hypothese)
    user_confirmed_type;     // Nutzer hat Dokumenttyp bestätigt
    user_confirmed_intent;   // Nutzer hat Intent bestätigt
    schema_bound;            // vw-doc-ai Schema zugewiesen
    extraction_started;      // vw-doc-ai Extraktion gestartet
    extraction_completed;    // vw-doc-ai Extraktion fertig
    extraction_failed;       // vw-doc-ai Extraktion fehlgeschlagen
    cross_validation;        // Cross-Validation durchgeführt
    business_validation;     // Business-Validation durchgeführt
    user_approved;           // Nutzer hat Freigabe erteilt
    hcm_action_submitted;    // HCM-Aktion eingereicht
    hcm_action_completed;    // HCM-Aktion abgeschlossen
  };
  payload   : LargeString;   // JSON mit Event-Details
}

// ─── Dokumentenverarbeitung (vw-doc-ai) ─────────────────
entity Documents : cuid, managed {
  caseRef      : Association to Cases;
  fileName     : String(500);
  mimeType     : String(100);
  fileHash     : String(64);              // SHA-256 für Deduplizierung
  status       : String enum { uploaded; pending; processing; done; failed };
  phase        : String enum {
    intake;           // nur hochgeladen, noch nicht analysiert
    analyzed;         // generische LLM-Analyse abgeschlossen
    schema_bound;     // Schema zugewiesen, Extraktion gestartet
    extracted;        // vw-doc-ai Extraktion abgeschlossen
    validated;        // Cross- und Business-Validation durchlaufen
  } default 'intake';
  documentType : String(100);
  jobId        : String(36);             // vw-doc-ai Job-ID
  schemaId     : String(36);            // vw-doc-ai Schema-ID
  aiAnalysis   : LargeString;            // JSON: generische LLM-Analyse-Ergebnis
  extractedData : Composition of many ExtractedFields on extractedData.document = $self;
}

entity ExtractedFields : cuid {
  document   : Association to Documents;
  fieldName  : String(200);
  fieldValue : LargeString;
  confidence : Decimal(5,4);
  rawValue   : LargeString;
  page       : Integer;
}

// ─── Simuliertes SAP HCM ───────────────────────────────
entity Employees : cuid {
  personnelNumber : String(8);
  firstName       : String(100);
  lastName        : String(100);
  email           : String(200);
  department      : String(200);
  position        : String(200);
  entryDate       : Date;
  weeklyHours     : Decimal(5,2);
  costCenter      : String(20);
}

entity HCMActions : cuid, managed {
  caseRef     : Association to Cases;
  employee    : Association to Employees;
  actionType  : String enum {
    elternzeit;
    teilzeit;
    vollzeit_rueckkehr;
    altersteilzeit;
    sabbatical;
    adressaenderung;
    gehaltsanpassung;
    fibu24_erstattung;
    krankmeldung;
    reisekostenerstattung;
  };
  status      : String enum { entwurf; eingereicht; genehmigt; abgelehnt; simuliert };
  payload     : LargeString;
  result      : LargeString;
}
