// Core Modules (Node.js)
import path from 'path';
import fs from 'fs/promises';

// Logic and Memory Modules
import { getDossier } from '../modules/profiler.mjs';
import { logEvent } from '../modules/logger.mjs';
import { vectorIndexer } from '../modules/memory.mjs';

// --- TOOLS ---
import * as hardware from '../tools/hardware.mjs';
import { generatePDF } from '../tools/designer.mjs';
import { smartExec } from '../tools/terminal_exec.mjs';

/**
 * Logs activity and executes indexing
 */
async function broadcastActivity(jid, toolName, args, result, status = 'SUCCESS') {
  const activity = {
    timestamp: new Date().toISOString(),
    jid,
    tool: toolName,
    params: args,
    status,
  };

  logEvent('DASHBOARD_FEED', JSON.stringify(activity), status === 'SUCCESS' ? 'INFO' : 'ERROR');

  try {
    const summary = `[ACTION EXECUTED] Tool: ${toolName} | Result: ${status} | Details: ${JSON.stringify(args)}`;
    await vectorIndexer(jid, summary, 'log_attivita');
  } catch (e) {
    logEvent('SYSTEM', 'Activity indexing error: ' + e.message, 'ERROR');
  }
}

// --- TOOLS DEFINITION ---
export const toolsmj = [
  {
    name: 'terminal_exec',
    description:
      'Executes shell commands with auto-diagnosis and safety checks. Admin only. Returns structured output for self-healing.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'create_professional_pdf',
    description:
      'Generates and sends a professional PDF document based on HTML. Supports templates, headers, footers, and custom CSS.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Name of the file (e.g. invoice.pdf)' },
        html_content: {
          type: 'string',
          description: 'The body content in HTML. Will be wrapped in a professional template.',
        },
        summary: { type: 'string', description: 'Brief description of the PDF for the user' },
        options: {
          type: 'object',
          description: 'Optional layout settings',
          properties: {
            format: { type: 'string', enum: ['A4', 'Letter', 'A3'], default: 'A4' },
            headerTemplate: { type: 'string', description: 'HTML template for the header' },
            footerTemplate: { type: 'string', description: 'HTML template for the footer' },
          },
        },
      },
      required: ['filename', 'html_content', 'summary'],
    },
  },
  // ... (other tools remain the same)
];

// --- EXECUTION MANAGER ---
export async function handleToolCall(call, sock, jid) {
  const user = await getDossier(jid);
  const isAdmin = user.level === 1;
  let output;

  // 🔑 CRUCIAL FIX: Transform 'arguments' string into 'args' object
  let args;
  try {
    args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.args || {};
  } catch (e) {
    logEvent('SYSTEM', `❌ Tool ${call.name} arguments parsing error: ${e.message}`, 'ERROR');
    args = {};
  }

  try {
    switch (call.name) {
      case 'terminal_exec': {
        if (!isAdmin) return '⚠️ Access denied: Only Admin can execute Shell commands.';

        const result = await smartExec(args.command || '');

        if (result.success) {
          output = `✅ Command executed on ${result.os}:\n${result.output}`;
        } else {
          output = `❌ Error: ${result.error}\n💡 Hint: ${result.suggestion}`;
        }
        break;
      }

      case 'create_professional_pdf': {
        if (!isAdmin) return '⚠️ Access denied.';
        // 'args.filename' is now correctly defined
        const finalFilename = args.filename || `doc_${Date.now()}.pdf`;
        logEvent('DESIGNER', `✍️ PDF Generation: ${finalFilename}`, 'INFO');

        const pdfResult = await generatePDF(args);

        if (pdfResult.success) {
          const fileBuffer = await fs.readFile(pdfResult.path);
          await sock.sendMessage(jid, {
            document: fileBuffer,
            mimetype: 'application/pdf',
            fileName: finalFilename.endsWith('.pdf') ? finalFilename : `${finalFilename}.pdf`,
            caption: `📄 *SERVER DOC*\n\n${args.summary || ''}`,
          });
          output = `✅ PDF '${finalFilename}' sent successfully.`;
        } else {
          output = `❌ PDF Error: ${pdfResult.error}`;
        }
        break;
      }

      case 'system_control':
        output = await hardware.getSystemReport();
        break;

      case 'print_text_document': {
        if (!isAdmin) return '⚠️ Access denied.';
        const tempPath = path.join('/tmp', `print_${Date.now()}.txt`);
        await fs.writeFile(tempPath, args.content || '');
        await smartExec(`lp -d Stampante_Boss -o ColorModel=Gray "${tempPath}"`);
        output = '✅ Document sent to the print queue.';
        break;
      }

      default:
        output = `Tool ${call.name} was called but handler needs better configuration.`;
    }

    await broadcastActivity(jid, call.name, args, output, 'SUCCESS');
    return output;
  } catch (err) {
    logEvent('SYSTEM', `Tool ${call.name} Error: ${err.message}`, 'ERROR');
    await broadcastActivity(jid, call.name, args, err.message, 'ERROR');
    return `❌ Critical error: ${err.message}`;
  }
}
