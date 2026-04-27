import puppeteer, { Browser } from "puppeteer";
import logger from "../middleware/logger.js";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (browser && browser.connected) return browser;
    browser = await puppeteer.launch({
        headless: true,
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
        await page.setContent(htmlContent, { waitUntil: "networkidle0", timeout: 30000 });
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
