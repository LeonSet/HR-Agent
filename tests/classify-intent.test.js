/**
 * Tests: Intent-Klassifikation im Workflow-Kontext
 *
 * 1. classifyIntentRegex – Regex-Fallback (synchron, deterministisch)
 * 2. classifyIntent – LLM-basiert mit Mock (async)
 *
 * Läuft mit Node.js built-in test runner: `node --test tests/`
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent, classifyIntentRegex } = require('../srv/lib/workflow-engine');

// ═══════════════════════════════════════════════════════
// Regex-Fallback (deterministisch)
// ═══════════════════════════════════════════════════════

describe('classifyIntentRegex', () => {

  // ─── Confirm ────────────────────────────────────────
  describe('confirm', () => {
    const cases = [
      ['Ja', 'confirm'],
      ['ja, verarbeiten', 'confirm'],
      ['Ja, Erstattung vorbereiten', 'confirm'],
      ['Ok', 'confirm'],
      ['Stimmt', 'confirm'],
      ['Weiter', 'confirm'],
      ['Erstattung vorbereiten und direkt verbuchen bitte', 'confirm'],
      ['Mach das', 'confirm'],
      ['Los', 'confirm'],
      ['Passt', 'confirm'],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" → ${expected}`, () => {
        assert.equal(classifyIntentRegex(input), expected);
      });
    }
  });

  // ─── Deny ───────────────────────────────────────────
  describe('deny', () => {
    const cases = [
      ['Nein', 'deny'],
      ['Nein, abbrechen', 'deny'],
      ['Abbrechen', 'deny'],
      ['Stopp', 'deny'],
      ['Cancel', 'deny'],
      ['Stimmt nicht', 'deny'],
      ['Nicht richtig', 'deny'],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" → ${expected}`, () => {
        assert.equal(classifyIntentRegex(input), expected);
      });
    }
  });

  // ─── Extract Only ──────────────────────────────────
  describe('extract_only', () => {
    const cases = [
      ['Nur Daten prüfen', 'extract_only'],
      ['Nein sag mir nur welche Daten', 'extract_only'],
      ['Nein, nur Daten prüfen', 'extract_only'],
      ['Nein, zeig mir die Daten', 'extract_only'],
      ['Welche Daten hast du erkannt?', 'extract_only'],
      ['Nur Daten zeigen bitte', 'extract_only'],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" → ${expected}`, () => {
        assert.equal(classifyIntentRegex(input), expected);
      });
    }
  });

  // ─── Correct ───────────────────────────────────────
  describe('correct', () => {
    const cases = [
      ['Daten korrigieren', 'correct'],
      ['Änderung vornehmen', 'correct'],
      ['Anpassen', 'correct'],
      ['Das muss korrigiert werden', 'correct'],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" → ${expected}`, () => {
        assert.equal(classifyIntentRegex(input), expected);
      });
    }
  });

  // ─── Unclear ───────────────────────────────────────
  describe('unclear', () => {
    const cases = [
      ['', 'unclear'],
      [null, 'unclear'],
      ['Hallo', 'unclear'],
      ['Was ist das denn?', 'unclear'],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" → ${expected}`, () => {
        assert.equal(classifyIntentRegex(input), expected);
      });
    }
  });
});

// ═══════════════════════════════════════════════════════
// LLM-basierte Klassifikation (mit Mock)
// ═══════════════════════════════════════════════════════

describe('classifyIntent (LLM)', () => {

  function mockOpenAI(responseText) {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: responseText } }],
          }),
        },
      },
    };
  }

  it('nutzt LLM-Ergebnis wenn verfügbar', async () => {
    const openai = mockOpenAI('confirm');
    const result = await classifyIntent('Bitte mach weiter damit', openai, 'gpt-4o-mini');
    assert.equal(result, 'confirm');
  });

  it('erkennt Intent auch mit Whitespace/Großschreibung', async () => {
    const openai = mockOpenAI('  Deny  ');
    const result = await classifyIntent('Nein danke', openai, 'gpt-4o-mini');
    assert.equal(result, 'deny');
  });

  it('fällt auf Regex zurück bei ungültigem LLM-Output', async () => {
    const openai = mockOpenAI('Ich bin mir nicht sicher');
    const result = await classifyIntent('Ja', openai, 'gpt-4o-mini');
    assert.equal(result, 'confirm'); // Regex-Fallback
  });

  it('fällt auf Regex zurück bei LLM-Fehler', async () => {
    const openai = {
      chat: {
        completions: {
          create: async () => { throw new Error('API Error'); },
        },
      },
    };
    const result = await classifyIntent('Nein', openai, 'gpt-4o-mini');
    assert.equal(result, 'deny'); // Regex-Fallback
  });

  it('nutzt Regex-Fallback ohne openai', async () => {
    const result = await classifyIntent('Ok', null, null);
    assert.equal(result, 'confirm');
  });

  it('gibt unclear bei leerem Input zurück', async () => {
    const result = await classifyIntent(null, null, null);
    assert.equal(result, 'unclear');
  });
});
