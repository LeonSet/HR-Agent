/**
 * Personalprodukt-Registry
 *
 * Lädt alle Personalprodukt-Definitionen und bietet Matching-Funktionen.
 * Neues Produkt hinzufügen = neue Datei in diesem Ordner + hier registrieren.
 */

const fibu24 = require('./fibu24');

// ─── Alle registrierten Produkte ─────────────────────────
const PRODUCTS = [
  fibu24,
  // Hier weitere Produkte eintragen:
  // require('./elternzeit'),
  // require('./krankmeldung'),
  // require('./reisekosten'),
];

// Index by ID für schnellen Zugriff
const PRODUCTS_BY_ID = {};
for (const p of PRODUCTS) { PRODUCTS_BY_ID[p.id] = p; }

/**
 * Findet ein Produkt anhand seiner ID.
 */
function getProduct(productId) {
  return PRODUCTS_BY_ID[productId] || null;
}

/**
 * Matcht ein Produkt anhand von Trigger-Keywords.
 * Prüft Dateiname UND User-Nachricht.
 *
 * @param {string} fileName - Dateiname des Dokuments
 * @param {string} [userMessage] - Begleitnachricht des Users
 * @returns {{ product, matchedTriggers: string[] } | null}
 */
function matchProduct(fileName, userMessage) {
  const input = `${fileName || ''} ${userMessage || ''}`.toLowerCase();

  for (const p of PRODUCTS) {
    const matched = p.triggers.filter(t => input.includes(t));
    if (matched.length > 0) {
      return { product: p, matchedTriggers: matched };
    }
  }
  return null;
}

/**
 * Gibt alle registrierten Produkte als Übersicht zurück.
 * Wird für den System-Prompt und "Was kann ich tun?"-Fragen genutzt.
 */
function listProducts() {
  return PRODUCTS.map(p => ({
    id: p.id,
    label: p.label,
    description: p.description,
    hcmAction: p.hcmAction,
    hasSchema: !!p.docai.schemaId,
  }));
}

/**
 * Gibt die Produkt-Labels als Auswahl-Optionen zurück.
 * Für den Fall, dass der User den Dokumenttyp manuell wählen muss.
 */
function getProductChoices() {
  return PRODUCTS.map(p => p.label);
}

/**
 * Findet ein Produkt anhand des Labels (vom User gewählt).
 */
function findProductByLabel(label) {
  const lower = (label || '').toLowerCase();
  return PRODUCTS.find(p =>
    p.label.toLowerCase().includes(lower) ||
    lower.includes(p.id)
  ) || null;
}

module.exports = {
  getProduct,
  matchProduct,
  listProducts,
  getProductChoices,
  findProductByLabel,
  PRODUCTS,
};
