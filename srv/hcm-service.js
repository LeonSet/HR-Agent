const cds = require('@sap/cds');

module.exports = class HCMService extends cds.ApplicationService {

  init() {
    const { Employees, Actions } = this.entities;

    // ─── Mitarbeiterdaten abrufen (simuliert) ───
    this.on('getEmployeeData', async (req) => {
      const { personnelNumber } = req.data;

      const employee = await SELECT.one.from(Employees)
        .where({ personnelNumber });

      if (employee) return { employee };

      // Fallback: simuliert
      return {
        employee: {
          personnelNumber: personnelNumber || '00012345',
          firstName: 'Max',
          lastName: 'Mustermann',
          department: 'IT Services',
          position: 'Senior Entwickler',
          weeklyHours: 40.00,
        },
      };
    });

    // ─── HR-Aktion validieren (simuliert) ───
    this.on('validateAction', async (req) => {
      const { actionType, payload } = req.data;
      let data;
      try { data = JSON.parse(payload || '{}'); }
      catch { return { valid: false, messages: ['Ungültiges JSON im Payload'] }; }

      const messages = [];
      let valid = true;

      switch (actionType) {
        case 'elternzeit':
          if (!data.beginn) { valid = false; messages.push('Beginn der Elternzeit fehlt'); }
          if (!data.ende) { valid = false; messages.push('Ende der Elternzeit fehlt'); }
          if (data.beginn && data.ende && new Date(data.beginn) >= new Date(data.ende)) {
            valid = false; messages.push('Beginn muss vor dem Ende liegen');
          }
          if (valid) messages.push('Validierung erfolgreich – Elternzeit-Antrag kann eingereicht werden');
          break;

        case 'teilzeit':
          if (!data.wochenstunden) { valid = false; messages.push('Gewünschte Wochenstunden fehlen'); }
          if (data.wochenstunden && (data.wochenstunden < 5 || data.wochenstunden > 39)) {
            valid = false; messages.push('Wochenstunden müssen zwischen 5 und 39 liegen');
          }
          if (!data.beginn) { valid = false; messages.push('Gewünschter Beginn fehlt'); }
          if (valid) messages.push('Validierung erfolgreich – Teilzeitantrag wird vorbereitet');
          break;

        case 'vollzeit_rueckkehr':
          if (!data.beginn) { valid = false; messages.push('Gewünschtes Rückkehrdatum fehlt'); }
          if (valid) messages.push('Validierung erfolgreich – Rückkehr in Vollzeit kann eingeleitet werden');
          break;

        default:
          if (valid) messages.push(`Aktion '${actionType}' vorvalidiert`);
      }

      return { valid, messages };
    });

    // ─── HR-Aktion einreichen (simuliert) ───
    this.on('submitAction', async (req) => {
      const { actionType, employeeId, payload } = req.data;

      // Validierung vorab
      const validation = await this.send('validateAction', { actionType, payload });
      if (!validation.valid) {
        return req.reject(400, validation.messages.join('; '));
      }

      const actionId = cds.utils.uuid();
      await INSERT.into(Actions).entries({
        ID: actionId,
        employee_ID: employeeId,
        actionType,
        status: 'simuliert',
        payload,
        result: JSON.stringify({
          message: `${actionType} wurde simuliert eingereicht`,
          timestamp: new Date().toISOString(),
          validationMessages: validation.messages,
        }),
      });

      return {
        actionId,
        status: 'simuliert',
        message: `HR-Aktion '${actionType}' erfolgreich simuliert. ` +
          'In Produktion wird diese Aktion im SAP HCM System verarbeitet.',
      };
    });

    return super.init();
  }
};
