import fs from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import logger from '../../middleware/logger.js';
import { footerTemplate, headerTemplate } from './jn-report.base.js';

let sharedBrowser: Browser | null = null;

function getChromeExecutablePath(): string | undefined {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Check workspace .cache/puppeteer/chrome
    const cacheBasePath = path.join(process.cwd(), '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cacheBasePath)) {
        const versions = fs.readdirSync(cacheBasePath);
        for (const ver of versions) {
            const candidate = path.join(cacheBasePath, ver, 'chrome-linux64', 'chrome');
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

async function getBrowser(): Promise<Browser> {
    if (sharedBrowser && sharedBrowser.connected) {
        return sharedBrowser;
    }

    const execPath = getChromeExecutablePath();
    logger.info('Launching Puppeteer browser for JN Reports...', { executablePath: execPath || 'default' });

    sharedBrowser = await puppeteer.launch({
        headless: true,
        executablePath: execPath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
        ],
    });

    return sharedBrowser;
}

export async function renderJnReportPDF(html: string, reportName: string): Promise<Buffer> {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1.5 });
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.evaluateHandle('document.fonts.ready');

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate,
            footerTemplate: footerTemplate(reportName),
            margin: {
                top: '14mm',
                bottom: '16mm',
                left: '12mm',
                right: '12mm',
            },
        });

        return Buffer.from(pdf);
    } finally {
        await page.close();
    }
}

// Graceful cleanup
process.on('exit', () => { sharedBrowser?.close(); });
process.on('SIGINT', () => { sharedBrowser?.close(); });
process.on('SIGTERM', () => { sharedBrowser?.close(); });
