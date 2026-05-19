import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { logEvent } from '../modules/logger.mjs';

/**
 * DEFAULT PROFESSIONAL STYLES
 */
const DEFAULT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
  
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #333;
    margin: 0;
    padding: 0;
  }
  .container {
    padding: 20px;
  }
  h1, h2, h3 {
    color: #1a202c;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
    margin-top: 24px;
  }
  h1 { font-size: 24pt; }
  p { margin-bottom: 12pt; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16pt;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 8pt;
    text-align: left;
  }
  th {
    background-color: #f7fafc;
    font-weight: bold;
  }
  .footer {
    font-size: 9pt;
    color: #718096;
    text-align: center;
    border-top: 1px solid #e2e8f0;
    margin-top: 40px;
    padding-top: 10px;
  }
`;

/**
 * Wraps raw content into a professional HTML template
 */
function wrapInTemplate(content, title = 'Document') {
  return `
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>${DEFAULT_CSS}</style>
    </head>
    <body>
      <div class="container">
        ${content}
      </div>
    </body>
    </html>
  `;
}

export async function generatePDF(args) {
  let browser;
  try {
    const { filename, html_content, summary, options = {} } = args;

    if (!html_content) {
      throw new Error('Contenuto HTML mancante nei parametri');
    }

    logEvent('DESIGNER', `🛡️ Rendering professionale per: ${filename}`, 'QUEUE');

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Determine if we should wrap in a template
    const fullHtml = html_content.includes('<body')
      ? html_content
      : wrapInTemplate(html_content, summary || 'Francesca AI Document');

    await page.setContent(fullHtml, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const dir = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const finalPath = path.join(dir, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);

    // Enhanced PDF options
    const pdfOptions = {
      path: finalPath,
      format: options.format || 'A4',
      margin: options.margin || { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: options.headerTemplate || '<div></div>',
      footerTemplate:
        options.footerTemplate ||
        `
        <div style="font-family: Arial, sans-serif; font-size: 10px; color: #cbd5e0; width: 100%; text-align: center; padding: 0 20mm;">
          <span class="title"></span> - <span class="date"></span> - Pagina <span class="pageNumber"></span> di <span class="totalPages"></span>
        </div>
      `,
    };

    await page.pdf(pdfOptions);

    logEvent('DESIGNER', `✅ PDF PROFESSIONALE CREATO: ${finalPath}`, 'SUCCESS');
    return { success: true, path: finalPath };
  } catch (e) {
    logEvent('DESIGNER', `🚨 ERRORE GENERAZIONE PDF: ${e.message}`, 'ERROR');
    return { success: false, error: e.message };
  } finally {
    if (browser) await browser.close();
  }
}
