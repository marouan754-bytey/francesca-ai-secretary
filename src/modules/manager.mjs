import { logEvent } from './logger.mjs';

/**
 * MANAGER MODULE V1.0 - "Boss's Decision Link"
 * Handles the logic for escalated requests and quick response options.
 */

// Memory of pending escalations: Key = Admin Message ID, Value = { clientJid, originalQuestion }
const pendingEscalations = new Map();
let lastEscalationId = null;

export const ManagerModule = {
  /**
   * Registers a new escalation to track the Boss's response
   */
  async registerEscalation(adminMsgId, clientJid, question) {
    pendingEscalations.set(adminMsgId, { clientJid, question, timestamp: Date.now() });
    lastEscalationId = adminMsgId;

    // Cleanup old escalations after 24h
    if (pendingEscalations.size > 100) {
      const now = Date.now();
      for (const [id, data] of pendingEscalations) {
        if (now - data.timestamp > 86400000) {
          pendingEscalations.delete(id);
          if (lastEscalationId === id) lastEscalationId = null;
        }
      }
    }
  },

  /**
   * Checks if a message from the Boss is a reply to an escalation
   */
  async handleBossReply(sock, m) {
    const msgText = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    const quotedMsgId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
    
    let escalationId = null;

    // 1. Priority: Direct Reply (Quote)
    if (quotedMsgId && pendingEscalations.has(quotedMsgId)) {
      escalationId = quotedMsgId;
    } 
    // 2. Fallback: If text is just a number (1, 2, 3) and there is a recent escalation
    else if (/^[123]$/.test(msgText.trim()) && lastEscalationId) {
      escalationId = lastEscalationId;
      logEvent('MANAGER', `Using fallback for numeric choice: ${msgText}`, 'INFO');
    }

    if (!escalationId) return false;

    const escalation = pendingEscalations.get(escalationId);
    const clientJid = escalation.clientJid;
    let finalResponse;

    logEvent('MANAGER', `Boss decision for client ${clientJid}: ${msgText}`, 'INFO');

    // 💡 DYNAMIC RESPONSE MAPPING
    const choice = msgText.trim();
    const dynamicOptions = escalation.question?.options || {}; // Extract dynamic options if they exist

    if (choice === '1' && dynamicOptions['1']) {
      finalResponse = dynamicOptions['1'];
    } else if (choice === '2' && dynamicOptions['2']) {
      finalResponse = dynamicOptions['2'];
    } else if (choice === '3' && dynamicOptions['3']) {
      finalResponse = dynamicOptions['3'];
    } else if (choice === '1' || choice.toLowerCase().includes('procedi')) {
      finalResponse =
        'Ho parlato con il mio responsabile: la tua richiesta è stata approvata! Procedo subito.';
    } else if (choice === '2' || choice.toLowerCase().includes('no')) {
      finalResponse =
        'Mi dispiace, il mio responsabile mi ha comunicato che al momento non è possibile procedere con la tua richiesta.';
    } else if (choice === '3' || choice.toLowerCase().includes('ricontatterò')) {
      finalResponse =
        "Il mio responsabile ti ricontatterà personalmente più tardi per approfondire la tua richiesta. Grazie per l'attesa!";
    } else {
      // Manual response from Boss
      finalResponse = msgText;
    }

    try {
      await sock.sendMessage(clientJid, { text: finalResponse });
      await sock.sendMessage(m.key.remoteJid, { react: { text: '✅', key: m.key } });

      // Remove from pending
      pendingEscalations.delete(escalationId);
      if (lastEscalationId === escalationId) lastEscalationId = null;
      return true;
    } catch (e) {
      logEvent('SYSTEM', `Error sending Boss decision to client: ${e.message}`, 'ERROR');
      return false;
    }
  },
};
