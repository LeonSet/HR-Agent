/**
 * Custom CAP Server
 *
 * Phase 1: Intake – Dokument speichern, Case anlegen, KEIN Schema binden
 * Phase 2: Schema-Extraktion – erst nach Agent-Analyse + Nutzerbestätigung
 */
const cds = require('@sap/cds');
const crypto = require('crypto');
const vwDocAi = require('./srv/lib/vw-doc-ai-client');
const { runCrossValidation, getSimulatedExtraction, getSchema, resolveUploadConfig } = require('./srv/lib/document-schemas');

cds.on('bootstrap', (app) => {
  const express = require('express');
  app.use(express.json());

  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ─── POST /api/documents/upload – Phase 1: Intake ────
  // Speichert Datei + legt Case an. Kein Schema, kein vw-doc-ai-Aufruf.
  // Der Agent analysiert danach generisch und fragt bei Bedarf nach.
  app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

      const { Documents, Cases, CaseEvents } = cds.entities('hr.agent');
      const { sessionId } = req.body;

      const docId = cds.utils.uuid();
      const caseId = cds.utils.uuid();
      const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      // Case anlegen
      await INSERT.into(Cases).entries({
        ID: caseId,
        session_ID: sessionId || null,
        status: 'open',
      });

      // Dokument als Intake speichern – KEIN documentType, KEIN schemaId
      await INSERT.into(Documents).entries({
        ID: docId,
        caseRef_ID: caseId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileHash,
        status: 'uploaded',
        phase: 'intake',
        documentType: null,
        schemaId: null,
      });

      // Audit: document_uploaded
      await INSERT.into(CaseEvents).entries({
        caseRef_ID: caseId,
        eventType: 'document_uploaded',
        payload: JSON.stringify({
          documentId: docId,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileHash,
          fileSize: req.file.buffer.length,
        }),
      });

      // File-Buffer im Memory halten für spätere vw-doc-ai Extraktion
      if (!global._pendingBuffers) global._pendingBuffers = {};
      global._pendingBuffers[docId] = req.file.buffer;

      // Buffer nach 10 Minuten aufräumen
      setTimeout(() => { delete global._pendingBuffers?.[docId]; }, 10 * 60 * 1000);

      console.log(`📄 Intake: "${req.file.originalname}" → Case ${caseId}, Doc ${docId} (kein Schema)`);

      return res.status(201).json({
        documentId: docId,
        caseId,
        status: 'uploaded',
        phase: 'intake',
      });
    } catch (err) {
      console.error('Upload-Fehler:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /api/documents/startExtraction – Phase 2 ───
  // Wird vom Agent aufgerufen, nachdem Dokumenttyp + Intent bestätigt sind.
  // Erst JETZT wird das Schema gebunden und vw-doc-ai aufgerufen.
  app.post('/api/documents/startExtraction', async (req, res) => {
    try {
      const { Documents, CaseEvents } = cds.entities('hr.agent');
      const { documentId, documentType } = req.body;

      if (!documentId || !documentType) {
        return res.status(400).json({ error: 'documentId und documentType sind erforderlich' });
      }

      const doc = await SELECT.one.from(Documents).where({ ID: documentId });
      if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

      const uploadConfig = resolveUploadConfig(documentType);
      const caseId = doc.caseRef_ID;

      // Schema binden
      await UPDATE(Documents, documentId).set({
        documentType,
        schemaId: uploadConfig.schemaId || null,
        phase: 'schema_bound',
        status: 'pending',
      });

      // Audit: schema_bound
      await INSERT.into(CaseEvents).entries({
        caseRef_ID: caseId,
        eventType: 'schema_bound',
        payload: JSON.stringify({
          documentId,
          documentType,
          schemaId: uploadConfig.schemaId,
          schemaName: uploadConfig.schemaName,
        }),
      });

      console.log(`🔗 Schema gebunden: Doc ${documentId} → ${documentType} (${uploadConfig.schemaName || 'kein Schema'})`);

      // ─── vw-doc-ai konfiguriert → echten Upload ────────
      const fileBuffer = global._pendingBuffers?.[documentId];
      if (vwDocAi.isConfigured() && fileBuffer) {
        try {
          const uploadOpts = {
            documentType: uploadConfig.documentType,
            ...(uploadConfig.schemaId ? { schemaId: uploadConfig.schemaId } : {}),
            schemaVersion: 1,
          };

          console.log(`🚀 vw-doc-ai Upload: Schema=${uploadConfig.schemaId || 'keins'}, Type=${uploadConfig.documentType}`);

          const result = await vwDocAi.uploadDocument(
            fileBuffer,
            doc.fileName,
            doc.mimeType,
            uploadOpts,
          );

          await UPDATE(Documents, documentId).set({ jobId: result.id, status: 'pending' });

          // Audit: extraction_started
          await INSERT.into(CaseEvents).entries({
            caseRef_ID: caseId,
            eventType: 'extraction_started',
            payload: JSON.stringify({ documentId, jobId: result.id, schemaName: uploadConfig.schemaName }),
          });

          // Buffer freigeben
          delete global._pendingBuffers[documentId];

          return res.json({
            documentId,
            jobId: result.id,
            status: 'pending',
            schemaName: uploadConfig.schemaName,
          });
        } catch (vwErr) {
          // vw-doc-ai nicht erreichbar → Fallback auf Simulation
          console.warn(`⚠️ vw-doc-ai nicht erreichbar, Fallback auf Simulation: ${vwErr.message}`);
        }
      }

      // ─── Simulation ───────────────────────────────────
      const simJobId = `sim-${cds.utils.uuid()}`;
      const simResult = getSimulatedExtraction(documentType);
      const simFields = simResult.headerFields || [];
      const { ExtractedFields } = cds.entities('hr.agent');

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

      // Audit: extraction_completed
      await INSERT.into(CaseEvents).entries({
        caseRef_ID: caseId,
        eventType: 'extraction_completed',
        payload: JSON.stringify({ documentId, jobId: simJobId, fieldCount: simFields.length, simulated: true }),
      });

      const validation = runCrossValidation(documentType, simFields);
      return res.json({
        documentId,
        jobId: simJobId,
        status: 'done',
        schemaName: uploadConfig.schemaName,
        validation,
      });
    } catch (err) {
      console.error('Extraction-Fehler:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── Health-Check ─────────────────────────────────────────────────────────
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // ─── Static Frontend (Production only) ────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    const path = require('path');
    app.use(express.static(path.join(__dirname, 'app/dist')));
    // SPA-Fallback: alle Nicht-API-Routen an index.html
    app.get(/^(?!\/api|\/odata|\/health).*$/, (req, res) => {
      res.sendFile(path.join(__dirname, 'app/dist/index.html'));
    });
  }
});

module.exports = cds.server;
