const cds = require('@sap/cds');

module.exports = class ChatService extends cds.ApplicationService {

  init() {
    const { Sessions, Messages } = this.entities;

    this.on('sendMessage', async (req) => {
      const { sessionId, message } = req.data;

      // Session erstellen oder laden
      let session;
      if (sessionId) {
        session = await SELECT.one.from(Sessions).where({ ID: sessionId });
      }
      if (!session) {
        session = { ID: cds.utils.uuid(), title: message.substring(0, 80) };
        await INSERT.into(Sessions).entries(session);
      }

      // User-Nachricht speichern
      await INSERT.into(Messages).entries({
        session_ID: session.ID,
        role: 'user',
        content: message,
      });

      // Bisherigen Verlauf laden
      const history = await SELECT.from(Messages)
        .where({ session_ID: session.ID })
        .orderBy('createdAt asc');

      // Antwort generieren (Prototyp: regelbasiert → wird später durch LLM ersetzt)
      const reply = generateResponse(message, history);

      // Antwort speichern
      await INSERT.into(Messages).entries({
        session_ID: session.ID,
        role: 'assistant',
        content: reply,
      });

      return {
        reply,
        sessionId: session.ID,
        suggestions: generateSuggestions(message),
      };
    });

    return super.init();
  }
};

// ─── Prototyp-Antwortgenerator (wird durch LLM ersetzt) ──
function generateResponse(message) {
  const msg = message.toLowerCase();

  if (msg.includes('elternzeit')) {
    return 'Elternzeit kann bis zu 3 Jahre pro Kind beantragt werden (BEEG §16). ' +
      'Der Antrag muss schriftlich mindestens 7 Wochen vor Beginn eingereicht werden. ' +
      'Laden Sie bitte Ihren Elternzeit-Antrag hoch – ich kann die relevanten Daten automatisch extrahieren und den Prozess einleiten.';
  }
  if (msg.includes('teilzeit')) {
    return 'Bei einer Betriebszugehörigkeit ab 6 Monaten haben Sie Anspruch auf Teilzeit (§§8ff. TzBfG). ' +
      'Stimmen Sie das gewünschte Modell mit Ihrer Führungskraft ab und stellen Sie den Antrag 3 Monate vor dem gewünschten Beginn. ' +
      'Ich kann den Antrag für Sie vorbereiten und die notwendige SAP-Validierung durchführen.';
  }
  if (msg.includes('dokument') || msg.includes('upload') || msg.includes('hochladen')) {
    return 'Sie können mir Dokumente hochladen und ich werde die relevanten Daten automatisch extrahieren. ' +
      'Unterstützt werden u.a. Arbeitsverträge, Gehaltsabrechnungen und Anträge. ' +
      'Die Extraktion erfolgt schema-basiert und auditfähig über vw-doc-ai.';
  }
  if (msg.includes('gehalt') || msg.includes('vergütung')) {
    return 'Ihre Vergütungsdetails finde ich im SAP HCM System. ' +
      'Die aktuelle Entgeltgruppe und eventuelle Änderungen kann ich für Sie abrufen und prüfen.';
  }
  if (msg.includes('urlaub')) {
    return 'Der Urlaubsanspruch beträgt 30 Tage bei Vollzeit. Bei Teilzeit wird er anteilig berechnet: ' +
      '30 Tage × (reduzierte Wochenstunden / 40 Std.). Ich kann Ihren aktuellen Resturlaub abfragen.';
  }
  if (msg.includes('hallo') || msg.includes('hi') || msg.includes('guten tag') || msg.includes('moin')) {
    return 'Hallo! Willkommen im HR Beratungscenter. Ich bin Ihr HR-Agent und kann Sie bei Personalthemen unterstützen – ' +
      'von Elternzeit über Teilzeit bis zu Dokumentenverarbeitung. Wie kann ich Ihnen helfen?';
  }

  return 'Vielen Dank für Ihre Anfrage. Als HR-Agent kann ich Sie bei folgenden Themen unterstützen:\n' +
    '• Elternzeit, Teilzeit und Arbeitszeitmodelle\n' +
    '• Dokumentenverarbeitung und Datenextraktion\n' +
    '• SAP HCM Datenabruf und Personalprozesse\n' +
    'Was genau möchten Sie wissen?';
}

function generateSuggestions(message) {
  const msg = message.toLowerCase();
  if (msg.includes('elternzeit')) return ['Wie beantrage ich Elternzeit?', 'Elterngeld berechnen', 'Dokument hochladen'];
  if (msg.includes('teilzeit'))   return ['Teilzeit-Modelle anzeigen', 'Urlaubsanspruch bei Teilzeit', 'Antrag vorbereiten'];
  if (msg.includes('dokument'))   return ['Arbeitsvertrag hochladen', 'Gehaltsabrechnung prüfen', 'Elternzeit-Antrag hochladen'];
  return ['Elternzeit beantragen', 'Teilzeit beantragen', 'Dokument hochladen'];
}
