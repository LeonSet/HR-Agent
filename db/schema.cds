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

// ─── Dokumentenverarbeitung (vw-doc-ai) ─────────────────
entity Documents : cuid, managed {
  fileName     : String(500);
  mimeType     : String(100);
  status       : String enum { uploaded; pending; processing; done; failed };
  documentType : String(100);
  jobId        : String(36);            // vw-doc-ai Job-ID
  schemaId     : String(36);            // vw-doc-ai Schema-ID
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
  employee    : Association to Employees;
  actionType  : String enum {
    elternzeit;
    teilzeit;
    vollzeit_rueckkehr;
    altersteilzeit;
    sabbatical;
    adressaenderung;
    gehaltsanpassung;
  };
  status      : String enum { entwurf; eingereicht; genehmigt; abgelehnt; simuliert };
  payload     : LargeString;
  result      : LargeString;
}
