import axios from 'axios';
import fs from 'fs';
import path from 'path';
import {
  loadDatabase,
  saveToDatabase,
  cleanHistory,
  searchMemories,
  vectorIndexer,
} from './memory.mjs';
import { toolsmj, handleToolCall } from '../tools/tool.mjs';
import { getDossier } from './profiler.mjs';
import { logEvent } from './logger.mjs';
import { personality } from './personality.mjs';
import { config } from '../config.mjs';
import { ManagerModule } from './manager.mjs';

// Single command point: LiteLLM Proxy
const PROXY_URL = config.proxyUrl;

export async function askFrancesca(jid, input, sock) {
  if (!sock) logEvent('BRAIN', '🚨 Note: Headless Mode', 'INFO');

  // 1. Profiling and DB loading
  const user = await getDossier(jid, typeof input === 'string' ? input : input.text || '');
  const db = loadDatabase();
  const isAdmin = user.level === 1;

  // 2. Input Analysis (Media or Text)
  const isMedia = typeof input === 'object' && input.inlineData;
  const messageText = isMedia ? input.text || '[Media Analysis]' : input;

  try {
    // 3. Local Semantic Search (Uses @xenova/transformers in memory.mjs)
    const memories = await searchMemories(jid, messageText, isAdmin);
    let history = cleanHistory(db, jid);

    // 3.5 Global Knowledge Base loading (only for clients)
    let knowledgeBaseStr = '';
    if (user.level !== 1) {
      try {
        const kbPath = path.join(process.cwd(), 'knowledge.json');
        if (fs.existsSync(kbPath)) {
          const kbContent = fs.readFileSync(kbPath, 'utf-8');
          knowledgeBaseStr = `
[COMPANY KNOWLEDGE BASE]:
${kbContent}

[STRICT INSTRUCTION]: 
1. If the client's request is NOT explicitly and clearly covered by the Knowledge Base above, you MUST ESCALATE.
2. Do NOT invent procedures, prices, dates, or any information not present in the Knowledge Base.
3. If you have any doubt, ESCALATE.
4. To escalate, your response MUST follow this exact structure:
[ASK_THE_BOSS]
Question: <A clear summary of what the client wants>
Option 1: <A smart, proactive proposed response for the Boss to approve>
Option 2: <A different smart alternative or a request for more info>
Option 3: <A polite way to decline or postpone>
`;
        }
      } catch (e) {
        logEvent('SYSTEM', `Error reading knowledge.json: ${e.message}`, 'WARNING');
      }
    }

    // 4. Dynamic Model Selection (Target for LiteLLM)
    let modelTarget = 'Base'; // Llama 3.3 via DeepInfra

    if (isMedia) modelTarget = 'francesca-vision'; // Gemini via Proxy
    if (messageText.toLowerCase().includes('pensa')) modelTarget = 'francesca-reasoning'; // DeepSeek via Proxy
    if (messageText.toLowerCase().includes('libero')) modelTarget = 'francesca-ollama'; // Dolphin Locale

    logEvent('BRAIN', `🚀 Routing -> [${modelTarget}]`, 'INFO');

    // 5. Context Building
    let systemInstruction = `
            ${personality.getInstruction(user, messageText)}
            [ADMIN_INFO]: Name: ${user.name} | Level: ${user.level}
            [LOCAL_MEMORIES]: ${memories || 'No previous tracks.'}
            ${knowledgeBaseStr}
        `;

    const messages = [
      { role: 'system', content: systemInstruction },
      ...history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.parts[0].text || '[Media/Data]',
      })),
    ];

    // Multimodal Management for LiteLLM (Standard OpenAI)
    if (isMedia) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: messageText },
          {
            type: 'image_url',
            image_url: { url: `data:${input.inlineData.mimeType};base64,${input.inlineData.data}` },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: messageText });
    }
    // --- 6. PROXY CALL ---
    const supportsTools = modelTarget !== 'francesca-vision';
    let response;

    const payload = {
      model: modelTarget === 'Base' ? 'groq/llama-3.3-70b-versatile' : modelTarget,
      messages: messages,
      temperature: isAdmin ? 0.6 : 0.4, // Lower temperature for clients = more precision
      tools:
        supportsTools && toolsmj
          ? toolsmj.map((t) => ({ type: 'function', function: t }))
          : undefined,
      tool_choice: supportsTools ? 'auto' : undefined,
    };

    try {
      response = await axios.post(PROXY_URL, payload, {
        headers: { Authorization: `Bearer ${config.masterKey}` },
      });
    } catch (proxyError) {
      if (proxyError.code === 'ECONNREFUSED') {
        logEvent('BRAIN', '⚠️ Proxy offline. Falling back to direct GROQ call...', 'WARNING');

        // Direct fallback to Groq if Proxy is down
        response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            ...payload,
            model: 'llama-3.3-70b-versatile', // Force direct model name
          },
          {
            headers: { Authorization: `Bearer ${config.groqApiKey}` },
          }
        );
      } else {
        throw proxyError;
      }
    }

    let responseMessage = response.data.choices[0].message;
    let responseText = responseMessage.content;
    const toolCalls = responseMessage.tool_calls;

    // --- 7. TOOLS EXECUTION (Only if necessary and supported) ---
    if (supportsTools && toolCalls && toolCalls.length > 0) {
      let toolResults = [];

      for (const call of toolCalls) {
        logEvent('BRAIN', `🛠️ Executing Tool: ${call.function.name}`, 'INFO');

        // Execute the real command
        const result = await handleToolCall(call.function, sock, jid);

        toolResults.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: String(result),
        });
      }

      // Final call to comment on the executed action
      try {
        const finalResponse = await axios.post(
          PROXY_URL,
          {
            model: modelTarget === 'Base' ? 'groq/llama-3.3-70b-versatile' : modelTarget,
            messages: [...messages, responseMessage, ...toolResults],
            temperature: isAdmin ? 0.6 : 0.4,
          },
          { headers: { Authorization: `Bearer ${config.masterKey}` } }
        );
        responseText = finalResponse.data.choices[0].message.content;
      } catch (proxyError) {
        if (proxyError.code === 'ECONNREFUSED') {
          const finalResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: [...messages, responseMessage, ...toolResults],
              temperature: isAdmin ? 0.6 : 0.4,
            },
            { headers: { Authorization: `Bearer ${config.groqApiKey}` } }
          );
          responseText = finalResponse.data.choices[0].message.content;
        } else {
          throw proxyError;
        }
      }
    }

    // --- 7.6. MANDATORY ESCALATION FOR CLIENTS ---
    // Every message from a non-admin MUST be reviewed by the Boss with 3 dynamic options.
    if (!isAdmin) {
      logEvent('BRAIN', `Mandatory escalation for client ${jid}`, 'INFO');
      
      // Request the AI to generate 3 smart options based on the conversation so far
      const escalationPrompt = `
        [MANDATORY_REVIEW]: The Boss must approve the response.
        Based on the client's message "${messageText}" and our knowledge/history, 
        generate 3 DIFFERENT and SMART proposed responses in Italian.
        
        Format your output EXACTLY like this:
        [ASK_THE_BOSS]
        Question: <Summary of client's need>
        Option 1: <Professional and direct response>
        Option 2: <Detailed or proactive alternative>
        Option 3: <Strategic or delaying response>
      `;

      try {
        const escalationAicall = await axios.post(PROXY_URL, {
          model: 'groq/llama-3.3-70b-versatile',
          messages: [...messages, { role: 'assistant', content: responseText }, { role: 'user', content: escalationPrompt }],
          temperature: 0.7
        }, { headers: { Authorization: `Bearer ${config.masterKey}` } });
        
        responseText = escalationAicall.data.choices[0].message.content;
      } catch (e) {
        // Fallback if the smart option generation fails
        responseText = `[ASK_THE_BOSS]\nQuestion: ${messageText}\nOption 1: Procedi pure.\nOption 2: Chiedi più dettagli.\nOption 3: Rimanda a più tardi.`;
      }
    }

    // --- 7.5. ESCALATION TO THE BOSS ---
    if (responseText.includes('[ASK_THE_BOSS]')) {
      const escalationContent = responseText.replace('[ASK_THE_BOSS]', '').trim();
      logEvent('ESCALATION', `Requested Boss intervention for client ${jid}`, 'WARNING');

      if (sock) {
        const adminJid = config.adminJid;

        // Parsing smart options
        const lines = escalationContent.split('\n');
        const question =
          lines
            .find((l) => l.startsWith('Question:'))
            ?.replace('Question:', '')
            .trim() || 'Intervento richiesto.';
        const opt1 =
          lines
            .find((l) => l.startsWith('Option 1:'))
            ?.replace('Option 1:', '')
            .trim() || 'Procedi pure.';
        const opt2 =
          lines
            .find((l) => l.startsWith('Option 2:'))
            ?.replace('Option 2:', '')
            .trim() || 'Nega richiesta.';
        const opt3 =
          lines
            .find((l) => l.startsWith('Option 3:'))
            ?.replace('Option 3:', '')
            .trim() || 'Ricontatterò io.';

        const rawId = jid.split('@')[0].split(':')[0];
        const isLid = jid.includes('@lid');
        const clientPhone = isLid ? `ID Sistema: ${rawId}` : `+${rawId}`;

        const bossAlert =
          `🚨 *ATTENZIONE: INTERVENTO RICHIESTO* 🚨\n\n` +
          `👤 *Cliente:* ${user.name || 'Sconosciuto'}\n` +
          `📱 *Contatto:* ${clientPhone}\n` +
          `💬 *Messaggio Cliente:* "${messageText}"\n\n` +
          `❓ *SINTESI QUESITO:*\n${question}\n\n` +
          `💡 *RISPOSTE SUGGERITE (Rispondi 1, 2 o 3):*\n` +
          `1️⃣ ${opt1}\n` +
          `2️⃣ ${opt2}\n` +
          `3️⃣ ${opt3}\n\n` +
          `_Puoi anche rispondere liberamente con un testo personalizzato._`;

        const sentMsg = await sock.sendMessage(adminJid, { text: bossAlert });

        if (sentMsg?.key?.id) {
          await ManagerModule.registerEscalation(sentMsg.key.id, jid, {
            question,
            options: { 1: opt1, 2: opt2, 3: opt3 },
          });
        }
      }

      responseText =
        'Ho inoltrato la tua richiesta al mio responsabile. Ti darò una risposta non appena possibile. Grazie per la pazienza!';
    }

    // --- 8. CLOSING AND MEMORY (RUGBY MODE 🏉) ---
    await saveToDatabase(db, jid, 'user', input);
    await saveToDatabase(db, jid, 'model', responseText);

    if (messageText.length > 15) {
      await vectorIndexer(jid, `U: ${messageText} | F: ${responseText}`);
      logEvent('MEMORY', `🧠 Concept saved for ${jid}`, 'SUCCESS');
    }

    return responseText;
  } catch (error) {
    console.error('FULL_BRAIN_ERROR:', error);
    const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
    logEvent('BRAIN', `🚨 ERROR: ${errorMsg}`, 'ERROR');
    return 'Boss, there is a technical problem in my brain. Check the server logs.';
  }
} // <--- Closes the main function (async function askFrancesca)
