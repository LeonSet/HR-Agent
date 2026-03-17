/**
 * Tests: document-schemas – Schema-Registry-Adapter
 *
 * Prüft, dass die Schema-Registry korrekt mit der Produkt-Registry zusammenarbeitet
 * und keine doppelten Definitionen existieren.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getSchema, listSchemas, inferDocumentType, resolveUploadConfig, runCrossValidation, getSimulatedExtraction } = require('../srv/lib/document-schemas');

describe('document-schemas (Registry-Adapter)', () => {

  describe('getSchema', () => {
    it('should find Fibu24 by product ID', () => {
      const schema = getSchema('fibu24');
      assert.ok(schema, 'Fibu24 sollte über Product-ID gefunden werden');
      assert.ok(schema.label.includes('Fibu24'));
    });

    it('should find Fibu24 by label', () => {
      const schema = getSchema('Fibu24-Nachweis');
      assert.ok(schema, 'Fibu24 sollte über Label gefunden werden');
    });

    it('should find legacy schemas (Elternzeit)', () => {
      const schema = getSchema('Elternzeit-Antrag');
      assert.ok(schema, 'Elternzeit sollte als Legacy-Schema existieren');
      assert.equal(schema.label, 'Elternzeit-Antrag');
    });

    it('should find legacy schemas (Krankmeldung)', () => {
      const schema = getSchema('Krankmeldung');
      assert.ok(schema);
    });

    it('should return null for unknown types', () => {
      assert.equal(getSchema('nonexistent'), null);
    });
  });

  describe('listSchemas', () => {
    it('should include products and legacy schemas', () => {
      const schemas = listSchemas();
      assert.ok(schemas.length >= 5, `Expected >= 5 schemas, got ${schemas.length}`);
      const labels = schemas.map(s => s.label);
      assert.ok(labels.some(l => l.includes('Fibu24')), 'Fibu24 fehlt');
      assert.ok(labels.some(l => l.includes('Elternzeit')), 'Elternzeit fehlt');
      assert.ok(labels.some(l => l.includes('Krankmeldung')), 'Krankmeldung fehlt');
    });

    it('should not have duplicates', () => {
      const schemas = listSchemas();
      const labels = schemas.map(s => s.label);
      const unique = [...new Set(labels)];
      assert.equal(labels.length, unique.length, `Duplikate gefunden: ${labels}`);
    });
  });

  describe('inferDocumentType', () => {
    it('should detect Fibu24 from keywords', () => {
      const type = inferDocumentType('fahrkarte-2024.pdf');
      assert.ok(type.includes('Fibu24') || type === 'fibu24' || type.includes('Fahrkarte'),
        `Expected Fibu24-related type, got: ${type}`);
    });

    it('should detect Elternzeit from keywords', () => {
      const type = inferDocumentType('elternzeit-antrag.pdf');
      assert.ok(type.includes('Elternzeit'), `Expected Elternzeit, got: ${type}`);
    });

    it('should return custom for unknown', () => {
      assert.equal(inferDocumentType('random.pdf'), 'custom');
    });
  });

  describe('resolveUploadConfig', () => {
    it('should resolve Fibu24 config from product', () => {
      const config = resolveUploadConfig('fibu24');
      assert.ok(config.schemaId, 'Fibu24 should have a schemaId');
      assert.ok(config.schemaName, 'Fibu24 should have a schemaName');
    });

    it('should return defaults for unknown type', () => {
      const config = resolveUploadConfig('nonexistent');
      assert.equal(config.documentType, 'custom');
      assert.equal(config.schemaId, null);
    });
  });

  describe('runCrossValidation', () => {
    it('should validate Fibu24 fields correctly', () => {
      const fields = [
        { name: 'Vorname', value: 'Andrea', confidence: 0.94 },
        { name: 'Nachname', value: 'Kirchhoff', confidence: 0.93 },
        { name: 'Gültig ab Datum', value: '2023-01-01', confidence: 0.96 },
        { name: 'Gültig bis Datum', value: '2023-12-31', confidence: 0.95 },
      ];
      const result = runCrossValidation('fibu24', fields);
      assert.ok(result.schemaFound, 'Schema sollte gefunden werden');
      assert.ok(result.isValid, 'Gültige Daten sollten valid sein');
    });

    it('should detect date issues', () => {
      const fields = [
        { name: 'Gültig ab Datum', value: '2024-12-31', confidence: 0.96 },
        { name: 'Gültig bis Datum', value: '2024-01-01', confidence: 0.95 },
      ];
      const result = runCrossValidation('fibu24', fields);
      assert.ok(result.issues.length > 0, 'Invertierte Daten sollten Issues erzeugen');
    });
  });

  describe('getSimulatedExtraction', () => {
    it('should return Fibu24 simulation data', () => {
      const sim = getSimulatedExtraction('fibu24');
      assert.ok(sim.headerFields.length > 0, 'Sollte Felder haben');
    });
  });
});
