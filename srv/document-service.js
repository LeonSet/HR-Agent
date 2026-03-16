const cds = require('@sap/cds');
const vwDocAi = require('./lib/vw-doc-ai-client');

module.exports = class DocumentService extends cds.ApplicationService {

  init() {
    const { Documents, ExtractedFields } = this.entities;

    // ─── Upload & Extraktion starten ────────────────────
    this.on('uploadAndExtract', async (req) => {
      const { fileName, mimeType, documentType, schemaId } = req.data;

      // Dokument-Eintrag anlegen
      const docId = cds.utils.uuid();
      await INSERT.into(Documents).entries({
        ID: docId,
        fileName,
        mimeType,
        documentType: documentType || 'custom',
        status: 'uploaded',
        schemaId: schemaId || null,
      });

      // Wenn vw-doc-ai konfiguriert → echten API-Call
      if (vwDocAi.isConfigured()) {
        try {
          // In einem echten Szenario kommt der fileBuffer vom Upload
          // Hier zeigen wir den Ablauf – der eigentliche File-Upload
          // wird über einen separaten multipart-Endpoint realisiert
          await UPDATE(Documents, docId).set({ status: 'pending' });

          return {
            documentId: docId,
            jobId: null, // wird beim tatsächlichen Upload gesetzt
            status: 'pending',
          };
        } catch (err) {
          await UPDATE(Documents, docId).set({ status: 'failed' });
          return req.reject(500, `vw-doc-ai Fehler: ${err.message}`);
        }
      }

      // Fallback: Simulation wenn vw-doc-ai nicht konfiguriert
      const simJobId = `sim-${cds.utils.uuid()}`;
      await UPDATE(Documents, docId).set({
        status: 'done',
        jobId: simJobId,
      });

      const simFields = getSimulatedExtraction(documentType);
      for (const field of simFields) {
        await INSERT.into(ExtractedFields).entries({
          document_ID: docId,
          fieldName: field.fieldName,
          fieldValue: field.fieldValue,
          confidence: field.confidence,
          rawValue: field.rawValue || field.fieldValue,
          page: field.page || 1,
        });
      }

      return {
        documentId: docId,
        jobId: simJobId,
        status: 'done',
      };
    });

    // ─── Job-Status pollen ──────────────────────────────
    this.on('pollJobStatus', async (req) => {
      const { documentId } = req.data;

      const doc = await SELECT.one.from(Documents).where({ ID: documentId });
      if (!doc) return req.reject(404, 'Dokument nicht gefunden');

      // Wenn vw-doc-ai konfiguriert und Job-ID vorhanden → echtes Polling
      if (vwDocAi.isConfigured() && doc.jobId && doc.status !== 'done' && doc.status !== 'failed') {
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
          } else if (result.status === 'FAILED') {
            await UPDATE(Documents, documentId).set({ status: 'failed' });
          } else {
            await UPDATE(Documents, documentId).set({
              status: result.status.toLowerCase(),
            });
          }
        } catch (err) {
          console.error('vw-doc-ai Poll-Fehler:', err);
        }
      }

      // Aktuelle Daten zurückgeben
      const updatedDoc = await SELECT.one.from(Documents).where({ ID: documentId });
      const fields = await SELECT.from(ExtractedFields).where({ document_ID: documentId });

      return {
        status: updatedDoc.status,
        extractedData: fields.map(f => ({
          fieldName: f.fieldName,
          fieldValue: f.fieldValue,
          confidence: f.confidence,
          rawValue: f.rawValue,
          page: f.page,
        })),
      };
    });

    // ─── Custom Express Endpoint für echten File-Upload ──
    this.on('bootstrap', () => {
      const express = require('express');
      const multer = require('multer');
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

      // POST /api/documents/upload – multipart file upload
      this.app?.post?.('/api/documents/upload', upload.single('file'), async (req, res) => {
        try {
          if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

          const { documentType, schemaId, schemaVersion } = req.body;
          const docId = cds.utils.uuid();

          // Dokument-Eintrag anlegen
          await INSERT.into(Documents).entries({
            ID: docId,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            documentType: documentType || 'custom',
            status: 'pending',
            schemaId: schemaId || null,
          });

          if (vwDocAi.isConfigured()) {
            const result = await vwDocAi.uploadDocument(
              req.file.buffer,
              req.file.originalname,
              req.file.mimetype,
              { documentType, schemaId, schemaVersion: Number(schemaVersion) || 1 }
            );

            await UPDATE(Documents, docId).set({ jobId: result.id, status: 'pending' });
            return res.status(201).json({ documentId: docId, jobId: result.id, status: 'pending' });
          }

          // Simulation
          const simJobId = `sim-${cds.utils.uuid()}`;
          const simFields = getSimulatedExtraction(documentType);
          await UPDATE(Documents, docId).set({ jobId: simJobId, status: 'done' });

          for (const field of simFields) {
            await INSERT.into(ExtractedFields).entries({
              document_ID: docId,
              fieldName: field.fieldName,
              fieldValue: field.fieldValue,
              confidence: field.confidence,
              rawValue: field.rawValue || field.fieldValue,
              page: field.page || 1,
            });
          }

          return res.status(201).json({ documentId: docId, jobId: simJobId, status: 'done' });
        } catch (err) {
          console.error('Upload-Fehler:', err);
          return res.status(500).json({ error: err.message });
        }
      });
    });

    return super.init();
  }
};

// ─── Simulierte Felder (wenn vw-doc-ai nicht konfiguriert) ──
function getSimulatedExtraction(documentType) {
  const templates = {
    'Arbeitsvertrag': [
      { fieldName: 'Arbeitnehmer_Name', fieldValue: 'Max Mustermann', confidence: 0.95, rawValue: 'Max Mustermann', page: 1 },
      { fieldName: 'Eintrittsdatum', fieldValue: '2024-01-15', confidence: 0.92, rawValue: '15.01.2024', page: 1 },
      { fieldName: 'Wochenarbeitszeit', fieldValue: '40', confidence: 0.98, rawValue: '40 Stunden', page: 1 },
      { fieldName: 'Entgeltgruppe', fieldValue: 'E12', confidence: 0.88, rawValue: 'E12', page: 2 },
      { fieldName: 'Kostenstelle', fieldValue: '4711', confidence: 0.91, rawValue: '4711', page: 2 },
    ],
    'Elternzeit-Antrag': [
      { fieldName: 'Antragsteller', fieldValue: 'Max Mustermann', confidence: 0.96, rawValue: 'Max Mustermann', page: 1 },
      { fieldName: 'Kind_Geburtsdatum', fieldValue: '2025-03-01', confidence: 0.94, rawValue: '01.03.2025', page: 1 },
      { fieldName: 'Beginn_Elternzeit', fieldValue: '2025-04-01', confidence: 0.97, rawValue: '01.04.2025', page: 1 },
      { fieldName: 'Ende_Elternzeit', fieldValue: '2026-03-31', confidence: 0.93, rawValue: '31.03.2026', page: 1 },
      { fieldName: 'Teilzeit_Waehrend_Elternzeit', fieldValue: 'Nein', confidence: 0.89, rawValue: 'Nein', page: 1 },
    ],
    'Gehaltsabrechnung': [
      { fieldName: 'Monat', fieldValue: '2025-12', confidence: 0.99, rawValue: 'Dezember 2025', page: 1 },
      { fieldName: 'Brutto', fieldValue: '5200.00', confidence: 0.96, rawValue: '5.200,00 EUR', page: 1 },
      { fieldName: 'Netto', fieldValue: '3180.00', confidence: 0.95, rawValue: '3.180,00 EUR', page: 1 },
      { fieldName: 'Steuerklasse', fieldValue: '1', confidence: 0.98, rawValue: '1', page: 1 },
    ],
  };

  return templates[documentType] || [
    { fieldName: 'Dokumenttyp', fieldValue: documentType || 'Unbekannt', confidence: 0.85, rawValue: documentType, page: 1 },
    { fieldName: 'Hinweis', fieldValue: 'Simulierte Extraktion – vw-doc-ai nicht konfiguriert', confidence: 1.0, rawValue: 'simulated', page: 1 },
  ];
}
