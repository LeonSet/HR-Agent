using { hr.agent as db } from '../db/schema';

// ─── Chat Service ───────────────────────────────────────
service ChatService @(path: '/api/chat', impl: './chat-service.js') {

  entity Sessions as projection on db.ChatSessions;
  entity Messages as projection on db.ChatMessages;

  action sendMessage(sessionId: UUID, message: String) returns {
    reply       : String;
    sessionId   : UUID;
    suggestions : array of String;
    toolCalls   : array of {
      tool   : String;
      args   : LargeString;
      result : LargeString;
    };
  };
}

// ─── Document Service (vw-doc-ai Integration) ───────────
service DocumentService @(path: '/api/documents', impl: './document-service.js') {

  entity Documents     as projection on db.Documents;
  entity ExtractedFields as projection on db.ExtractedFields;
  entity Cases         as projection on db.Cases;
  entity CaseEvents    as projection on db.CaseEvents;

  // Dokument hochladen → Intake (kein Schema, kein Workflow)
  action uploadAndExtract(
    fileName     : String,
    mimeType     : String,
    documentType : String,
    schemaId     : String
  ) returns {
    documentId : UUID;
    jobId      : String;
    status     : String;
  };

  // Job-Status von vw-doc-ai pollen
  action pollJobStatus(documentId : UUID) returns {
    status        : String;
    extractedData : array of {
      fieldName  : String;
      fieldValue : String;
      confidence : Decimal;
      rawValue   : String;
      page       : Integer;
    };
    validation : {
      documentType : String;
      isValid      : Boolean;
      issues       : array of String;
      validChecks  : array of String;
      fieldCount   : Integer;
      businessChecks : array of String;
    };
  };

  // Schema-gebundene Extraktion starten (Phase 2)
  action startSchemaExtraction(documentId : UUID, documentType : String) returns {
    documentId : UUID;
    jobId      : String;
    status     : String;
    schemaName : String;
  };
}

// ─── HCM Service (simuliert) ────────────────────────────
service HCMService @(path: '/api/hcm', impl: './hcm-service.js') {

  @readonly
  entity Employees as projection on db.Employees;
  entity Actions   as projection on db.HCMActions;

  action getEmployeeData(personnelNumber: String) returns {
    employee : {
      personnelNumber : String;
      firstName       : String;
      lastName        : String;
      department      : String;
      position        : String;
      weeklyHours     : Decimal;
    };
  };

  action validateAction(actionType: String, payload: String) returns {
    valid    : Boolean;
    messages : array of String;
  };

  action submitAction(actionType: String, employeeId: UUID, payload: String) returns {
    actionId : UUID;
    status   : String;
    message  : String;
  };
}
