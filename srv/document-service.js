const cds = require('@sap/cds');
const vwDocAi = require('./lib/vw-doc-ai-client');
const { runCrossValidation, getSimulatedExtraction, inferDocumentType, getSchema } = require('./lib/document-schemas');

module.exports = class DocumentService extends cds.ApplicationService {

  init() {
    const { Documents, ExtractedFields } = this.entities;

    // ─── Upload & Extraktion (CDS Action – ohne File-Buffer) ─
    // Wird nur für Metadaten-basierte Aufrufe genutzt.
    // Der echte File-Upload läuft über den Express-Endpoint.
    this.on('uploadAndExtract', async (req) => {
      const { fileName, mimeType, documentType, schemaId } = req.data;

      const docId = cds.utils.uuid();
      const resolvedType = documentType || inferDocumentType(fileName);
      const schema = getSchema(resolvedType);

      await INSERT.into(Documents).entries({
        ID: docId,
        fileName,
        mimeType,
        documentType: resolvedType,
        status: 'uploaded',
        schemaId: schemaId || schema?.schemaId || null,
      });

      // Ohne File-Buffer können wir nur simulieren
      const simJobId = `sim-${cds.utils.uuid()}`;
      await UPDATE(Documents, docId).set({ status: 'done', jobId: simJobId });

      const simResult = getSimulatedExtraction(resolvedType);
      const simFields = simResult.headerFields || [];
      for (const field of simFields) {
        await INSERT.into(ExtractedFields).entries({
          document_ID: docId,
          fieldName: field.name,
          fieldValue: field.value,
          confidence: field.confidence,
          rawValue: field.rawValue || field.value,
          page: field.page || 1,
        });
      }

      const validation = runCrossValidation(resolvedType, simFields);

      return {
        documentId: docId,
        jobId: simJobId,
        status: 'done',
        validation,
      };
    });

    // ─── Job-Status pollen ──────────────────────────────
    this.on('pollJobStatus', async (req) => {
      const { documentId } = req.data;

      const doc = await SELECT.one.from(Documents).where({ ID: documentId });
      if (!doc) return req.reject(404, 'Dokument nicht gefunden');

      // Wenn vw-doc-ai konfiguriert und Job-ID vorhanden → echtes Polling
      if (vwDocAi.isConfigured() && doc.jobId && !doc.jobId.startsWith('sim-')
          && doc.status !== 'done' && doc.status !== 'failed') {
        try {
          const result = await vwDocAi.getJobStatus(doc.jobId);

          if (result.status === 'DONE') {
            await UPDATE(Documents, documentId).set({ status: 'done' });

            // Extrahierte Felder speichern
            if (result.extraction?.headerFields) {
              for (const field of result.extraction.headerFields) {
                await INSERT.into(ExtractedFields).entries({
                  document_ID: documentId,
                  fieldName: field.name,
                  fieldValue: field.value,
                  confidence: field.confidence,
                  rawValue: field.rawValue,
                  page: field.page,
                });
              }
            }

            // Cross-Validation auf echte Extraktion
            const validation = runCrossValidation(doc.documentType, result.extraction?.headerFields || []);

            const fields = await SELECT.from(ExtractedFields).where({ document_ID: documentId });
            return {
              status: 'done',
              extractedData: fields.map(f => ({
                fieldName: f.fieldName,
                fieldValue: f.fieldValue,
                confidence: f.confidence,
                rawValue: f.rawValue,
                page: f.page,
              })),
              validation,
            };
          } else if (result.status === 'FAILED') {
            await UPDATE(Documents, documentId).set({ status: 'failed' });
            return { status: 'failed', extractedData: [] };
          } else {
            const mappedStatus = result.status.toLowerCase();
            await UPDATE(Documents, documentId).set({ status: mappedStatus });
            return { status: mappedStatus, extractedData: [] };
          }
        } catch (err) {
          console.error('vw-doc-ai Poll-Fehler:', err);
        }
      }

      // Aktuelle Daten zurückgeben (Simulation oder bereits abgeschlossene Jobs)
      const fields = await SELECT.from(ExtractedFields).where({ document_ID: documentId });

      const validation = doc.status === 'done'
        ? runCrossValidation(doc.documentType, fields)
        : null;

      return {
        status: doc.status,
        extractedData: fields.map(f => ({
          fieldName: f.fieldName,
          fieldValue: f.fieldValue,
          confidence: f.confidence,
          rawValue: f.rawValue,
          page: f.page,
        })),
        validation,
      };
    });

    return super.init();
  }
};

// ─── Express Middleware: File-Upload ─────────────────────
// Wird über cds.on('bootstrap') registriert (siehe server.js)


