import os from "os";
import fs from "fs";
import path from "path";
import puppeteer, { Browser } from "puppeteer";
import logger from "../middleware/logger.js";

let browser: Browser | null = null;

export function getChromeExecutablePath(): string | undefined {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const searchDirs = [
        path.join(process.cwd(), '.cache', 'puppeteer', 'chrome'),
        path.join(os.homedir(), '.cache', 'puppeteer', 'chrome'),
    ];

    for (const cacheBasePath of searchDirs) {
        if (fs.existsSync(cacheBasePath)) {
            const versions = fs.readdirSync(cacheBasePath);
            for (const ver of versions.reverse()) {
                const candidate = path.join(cacheBasePath, ver, 'chrome-linux64', 'chrome');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }

    return undefined;
}

async function getBrowser(): Promise<Browser> {
    if (browser && browser.connected) return browser;
    const execPath = getChromeExecutablePath();
    logger.info("Launching Puppeteer browser for FIRE Report...", { executablePath: execPath || "default" });

    browser = await puppeteer.launch({
        headless: true,
        executablePath: execPath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--font-render-hinting=none", // Disables thinning of fonts
            "--disable-font-subpixel-positioning"
        ],
    });
    logger.info("Puppeteer browser launched");
    return browser;
}

export async function renderPDF(htmlContent: string): Promise<Buffer> {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
        // Use a larger viewport for clearer chart/text rasterization before PDF print.
        await page.setViewport({ width: 1200, height: 1700, deviceScaleFactor: 1.5 });
        await page.setContent(htmlContent, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Wait for all custom fonts (base64 @font-face) to be fully loaded before printing.
        // window.__fontsReady is set by a <script> in the HTML once document.fonts.ready resolves.
        await page.waitForFunction("window.__fontsReady === true", { timeout: 10000 });
        const pdf = await page.pdf({
            width: "230mm",
            height: "330mm",
            printBackground: true,
            margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
        });
        return Buffer.from(pdf);
    } finally {
        await page.close();
    }
}

// Graceful shutdown
process.on("exit", () => { browser?.close(); });
process.on("SIGINT", () => { browser?.close(); process.exit(0); });
process.on("SIGTERM", () => { browser?.close(); process.exit(0); });
