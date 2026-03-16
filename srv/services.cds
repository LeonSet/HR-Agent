using { hr.agent as db } from '../db/schema';

// ─── Chat Service ───────────────────────────────────────
service ChatService @(path: '/api/chat') {

  entity Sessions as projection on db.ChatSessions;
  entity Messages as projection on db.ChatMessages;

  action sendMessage(sessionId: UUID, message: String) returns {
    reply       : String;
    sessionId   : UUID;
    suggestions : array of String;
  };
}

// ─── Document Service (vw-doc-ai Integration) ───────────
service DocumentService @(path: '/api/documents') {

  entity Documents as projection on db.Documents;
  entity ExtractedFields as projection on db.ExtractedFields;

  // Dokument hochladen → an vw-doc-ai weiterleiten
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
  };
}

// ─── HCM Service (simuliert) ────────────────────────────
service HCMService @(path: '/api/hcm') {

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
