/**
 * HR Knowledge Base
 *
 * Durchsuchbare Wissensbasis für den HR-Agent.
 * Inhalte werden in Chunks aufgeteilt und per Keyword-Suche durchsuchbar gemacht.
 * (In Produktion: Embedding-basierte Vektorsuche via SAP HANA Cloud Vector Engine)
 */

const knowledgeChunks = [
  {
    id: 'elternzeit-grundlagen',
    topic: 'Elternzeit',
    keywords: ['elternzeit', 'beeg', 'kind', 'geburt', 'mutterschutz', 'vater', 'mutter', 'baby'],
    content: `## Elternzeit – Grundlagen
- **Gesetzliche Grundlage:** BEEG §16: Bis zu 3 Jahre pro Kind.
- Aufteilung und gleichzeitige Inanspruchnahme beider Elternteile möglich.
- VOLKSWAGEN-Betriebsvereinbarung "Elternzeit": Zusätzliche FAQs, Musterformulare und Beratung über das HR-Portal.
- Betriebsratsbeteiligung: Information und Stellungnahme durch den örtlichen Betriebsrat.`,
  },
  {
    id: 'elternzeit-antrag',
    topic: 'Elternzeit',
    keywords: ['elternzeit', 'antrag', 'frist', 'beantragen', 'schriftlich', 'wochen'],
    content: `## Elternzeit – Antragstellung
- Schriftlich über das HR-Portal oder per Brief an die Personalabteilung mindestens 7 Wochen vor Beginn (§16 BEEG).
- Fristwahrung: Bei verspäteter Antragstellung können Ansprüche verloren gehen.
- Erforderliche Unterlagen: Ausgefüllter Elternzeit-Antrag, Geburtsurkunde des Kindes.`,
  },
  {
    id: 'elternzeit-gehalt',
    topic: 'Elternzeit',
    keywords: ['elternzeit', 'elterngeld', 'gehalt', 'netto', 'zuschuss', 'geld'],
    content: `## Elternzeit – Gehalts- und Sozialversicherungswirkung
- Elterngeld ersetzt ca. 65% des letzten Netto-Einkommens (max. 1.800€).
- VOLKSWAGEN-Elternzeitbeihilfe: Zuschuss auf Elterngeld ("Top-Up") für Tarifbeschäftigte bis zu 10% des letzten Nettogehalts (gem. Betriebsvereinbarung).
- Rückkehr: Wiederbesetzung der bisherigen Tätigkeit oder gleichwertige Position.`,
  },
  {
    id: 'teilzeit-grundlagen',
    topic: 'Teilzeit',
    keywords: ['teilzeit', 'reduzierung', 'stunden', 'arbeitszeit', 'tzbfg', 'wochenstunden'],
    content: `## Teilzeit – Grundlagen
- **Gesetzlicher Anspruch:** §§8ff. TzBfG: Anspruch bei ≥6 Monaten Betriebszugehörigkeit.
- VOLKSWAGEN-Tarifvertrag: Entgeltgruppen, Staffelung nach Arbeitszeit.
- Betriebsvereinbarung "Lebensphasengerechte Arbeitszeit":
  - Flexible Verteilung von Soll-Stunden, Gleitzeitrahmen (z.B. Kernarbeitszeit 9–15 Uhr).
  - Option auf Korridormodell (unterschiedliche Wochenarbeitszeiten innerhalb eines Jahres).`,
  },
  {
    id: 'teilzeit-antrag',
    topic: 'Teilzeit',
    keywords: ['teilzeit', 'antrag', 'frist', 'beantragen', 'monate', 'ablehnung'],
    content: `## Teilzeit – Antrag & Fristen
- Gewünschtes Modell mit Vorgesetztem abstimmen.
- Antrag über das HR-Portal 3 Monate vor gewünschtem Beginn.
- Ablehnung nur aus dringenden betrieblichen Gründen (z.B. Projekt- oder Produktionsengpässe) möglich.`,
  },
  {
    id: 'teilzeit-urlaub',
    topic: 'Teilzeit',
    keywords: ['teilzeit', 'urlaub', 'urlaubsanspruch', 'tage', 'anteilig'],
    content: `## Teilzeit – Urlaubsanspruch
- Anteilig nach reduzierten Arbeitstagen: 30 Tage × (verringerte Wochenstunden / 40 Std.)
- Beispiel: Bei 30 Wochenstunden = 30 × (30/40) = 22,5 Tage Urlaubsanspruch.
- Sozialversicherung: Beitragspflicht bleibt bestehen, Bemessungsgrundlage entsprechend der reduzierten Brutto-Bezüge.`,
  },
  {
    id: 'vollzeit-rueckkehr',
    topic: 'Vollzeit-Rückkehr',
    keywords: ['vollzeit', 'rückkehr', 'rueckkehr', 'zurück', 'aufstockung'],
    content: `## Rückkehr in Vollzeit
- **§9a TzBfG:** Anspruch auf Rückkehr innerhalb von 3 Monaten nach Teilzeit.
- Antrag über HR-Portal oder Mail an HR-Service-Center mindestens 3 Monate vorher.
- Abstimmung mit Führungskraft und Personalabteilung zur termingerechten Gehaltsanpassung.
- Zurück auf Vollzeit-Entgeltgruppe gemäß Tarifvertrag.
- Rückkehrgespräch (Wiedereingliederung), ggf. Einarbeitung in neue Prozesse.`,
  },
  {
    id: 'altersteilzeit',
    topic: 'Altersteilzeit',
    keywords: ['altersteilzeit', 'alter', 'rente', 'blockmodell', 'freistellung', 'vorruhestand'],
    content: `## Altersteilzeit
- VOLKSWAGEN-Tarifvertrag "Altersteilzeit": ab 55 Jahren, mind. 60 Monate Betriebszugehörigkeit.
- **Blockmodell:** Erst Vollzeitphase, dann Freistellungsphase.
- **Gleichmäßig (1:1-Modell):** Halbierung der Arbeitszeit für gesamten Zeitraum.
- Zuschussregelungen: Arbeitgeberzuschuss bis zu 20% der Brutto-Bezüge während der Arbeitsphase.
- Dienstvereinbarung 6 Monate vor Beginn, Abstimmung mit Betriebsrat und HR.`,
  },
  {
    id: 'sabbatical',
    topic: 'Sabbatical / Langzeitkonto',
    keywords: ['sabbatical', 'langzeitkonto', 'auszeit', 'freistellung', 'ansparen'],
    content: `## Sabbatical / Langzeitkonto
- VOLKSWAGEN-Betriebsvereinbarung "Arbeitszeitkonto" und Tarifvertrag Langzeitkonto (TV-LZK).
- **Überstundenguthaben:** Freizeitausgleich durch Anwesenheitskonto.
- **Entgeltguthaben:** Ansparen von Gehalt für späteres Sabbatical.
- Formular im HR-Portal – Genehmigung durch Führungskraft und HR-Kontrolle.
- Flexibel: 1 Monat bis mehrere Jahre.`,
  },
  {
    id: 'home-office',
    topic: 'Mobile Arbeit',
    keywords: ['homeoffice', 'home-office', 'mobil', 'remote', 'zuhause', 'mobile arbeit'],
    content: `## Mobile Arbeit
- BV "Mobile Arbeit": Home-Office-Regelungen, Höchstgrenzen, Spesen.
- Abstimmung der Home-Office-Tage mit der Führungskraft.
- IT-Ausstattung wird durch VOLKSWAGEN gestellt.`,
  },
  {
    id: 'hr-services',
    topic: 'HR Self-Services',
    keywords: ['portal', 'self-service', 'sap', 'successfactors', 'formulare', 'antrag', 'system'],
    content: `## HR-Self-Services
- SAP SuccessFactors: VOLKSWAGEN-Portal für alle Anträge und Formulare.
- Betriebsrat & Job-Center: Beratung und Unterstützung bei allen Lebensphasenmodellen.
- BV Überstundenausgleich: Tarifliche Freizeitausgleichsquoten.`,
  },
  {
    id: 'dokument-upload',
    topic: 'Dokumentenverarbeitung',
    keywords: ['dokument', 'upload', 'hochladen', 'vertrag', 'abrechnung', 'extraktion', 'pdf'],
    content: `## Dokumentenverarbeitung (vw-doc-ai)
- Der HR-Agent kann Dokumente automatisch verarbeiten und Daten extrahieren.
- Unterstützte Formate: PDF, PNG, JPG, TIFF (max. 50 MB).
- Dokumenttypen: Arbeitsverträge, Gehaltsabrechnungen, Elternzeit-Anträge, Teilzeit-Anträge u.v.m.
- Die Extraktion erfolgt schema-basiert und auditfähig mit Confidence-Scores.
- Ergebnisse können genehmigt oder abgelehnt werden (Human-in-the-Loop).`,
  },
];

/**
 * Durchsucht die Knowledge Base nach relevanten Chunks.
 * @param {string} query - Suchanfrage
 * @param {number} maxResults - Max. Anzahl Ergebnisse (Default: 3)
 * @returns {Array<{id, topic, content, score}>}
 */
function searchKnowledge(query, maxResults = 3) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scored = knowledgeChunks.map(chunk => {
    let score = 0;

    // Keyword-Matching
    for (const keyword of chunk.keywords) {
      if (queryLower.includes(keyword)) {
        score += 3;
      }
      for (const word of queryWords) {
        if (keyword.includes(word) || word.includes(keyword)) {
          score += 1;
        }
      }
    }

    // Topic-Matching
    if (queryLower.includes(chunk.topic.toLowerCase())) {
      score += 2;
    }

    return { ...chunk, score };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ id, topic, content, score }) => ({ id, topic, content, score }));
}

/**
 * Gibt alle verfügbaren Themen zurück.
 */
function listTopics() {
  const topics = [...new Set(knowledgeChunks.map(c => c.topic))];
  return topics;
}

module.exports = { searchKnowledge, listTopics, knowledgeChunks };
