import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pct, signClass } from './jn-report.format.js';
import { JnReportInvestor } from './jn-report.types.js';

export const BRAND = {
    navy: '#23336E',
    navy2: '#1A2650',
    cyan: '#00AEEF',
    ink: '#1F2733',
    muted: '#6B7280',
    line: '#E7EAF0',
    surface: '#FFFFFF',
    paper: '#F5F7FB',
    pos: '#12875A',
    neg: '#D64545',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Official Janta Nivesh logo, embedded as a data URI so the PDF is self-contained. */
let cachedLogoDataUri = '';
export function getLogoDataUri(): string {
    if (cachedLogoDataUri) return cachedLogoDataUri;

    const candidatePaths = [
        path.join(__dirname, 'assets', 'janta-nivesh-logo.png'),
        path.join(process.cwd(), 'src', 'lib', 'jn-report', 'assets', 'janta-nivesh-logo.png'),
        path.join(process.cwd(), 'src', 'assets', 'reports', 'janta-nivesh-logo.png'),
        path.join(process.cwd(), 'extras', 'jn', 'jn-reports', 'assets', 'janta-nivesh-logo.png'),
    ];

    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) {
                cachedLogoDataUri = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
                return cachedLogoDataUri;
            }
        } catch {
            // continue checking
        }
    }

    return '';
}

/** Logo <img> at a given height (keeps aspect ratio). */
export function logo({ height = 40 }: { height?: number } = {}): string {
    const dataUri = getLogoDataUri();
    return dataUri
        ? `<img src="${dataUri}" alt="Janta Nivesh" style="height:${height}px;width:auto;display:block"/>`
        : `<span style="font-size:18px;font-weight:800;color:${BRAND.navy}">JANTA<span style="color:${BRAND.cyan}">NIVESH</span></span>`;
}

/** Clean white statement header: logo left, report title right, navy→cyan accent rule. */
export function brandBar(title: string, subtitle: string): string {
    return `<div class="brandbar">
    <div class="brandbar-inner">
      <div>${logo({ height: 46 })}</div>
      <div class="brandbar-title">
        <div class="bt-main">${title}</div>
        <div class="bt-sub">${subtitle}</div>
      </div>
    </div>
    <div class="brandrule"></div>
  </div>`;
}

/** KPI tile. delta optional (adds signed % chip). */
export function kpi(
    label: string,
    value: string,
    { sub = '', delta = null as number | null, accent = false } = {}
): string {
    const chip = delta === null
        ? ''
        : `<span class="kpi-chip ${signClass(delta)}">${pct(delta)}</span>`;
    return `<div class="kpi ${accent ? 'kpi-accent' : ''}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value} ${chip}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

export function sectionTitle(t: string, note = ''): string {
    return `<div class="sec"><span class="sec-t">${t}</span>${note ? `<span class="sec-n">${note}</span>` : ''}</div>`;
}

export function disclaimer(investor: JnReportInvestor = {}): string {
    const arnText = investor.arn ? `ARN ${investor.arn}` : 'a registered AMFI distributor';
    return `<div class="disclaimer">
  <strong>Disclaimer.</strong> Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
  Past performance is not indicative of future returns. This is a computer-generated consolidated statement based on data
  from the registrars (CAMS/KFintech) and the AMCs, provided for information purposes only and does not constitute investment advice.
  NAVs and valuations are as of the stated date and may differ from realisable value. Please verify all figures against your
  official Consolidated Account Statement (CAS). Distributed by ${arnText};
  commissions may be earned on regular plans. For discrepancies, contact support@jantanivesh.in within 30 days.
</div>`;
}

/** Full HTML document shell with Inter fonts & print styles. */
export function shell({ title, body }: { title: string; body: string }): string {
    return `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: ${BRAND.ink}; font-size: 11px; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-variant-numeric: tabular-nums;
}
.wrap { padding: 0 4px; }
.brandbar { margin-bottom: 14px; }
.brandbar-inner { display: flex; align-items: center; justify-content: space-between; padding: 4px 2px 12px; }
.brandbar-title { text-align: right; }
.bt-main { font-size: 20px; font-weight: 800; letter-spacing: .01em; color: ${BRAND.navy}; }
.bt-sub { font-size: 10px; color: ${BRAND.muted}; margin-top: 3px; }
.brandrule { height: 3px; border-radius: 3px; background: linear-gradient(90deg, ${BRAND.navy} 0%, ${BRAND.cyan} 100%); }

.meta { display: flex; flex-wrap: wrap; gap: 6px 26px; padding: 10px 14px; background: ${BRAND.paper};
  border: 1px solid ${BRAND.line}; border-radius: 10px; margin-bottom: 14px; }
.meta div { font-size: 10.5px; }
.meta .k { color: ${BRAND.muted}; margin-right: 6px; }
.meta .v { font-weight: 600; color: ${BRAND.ink}; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.kpi { border: 1px solid ${BRAND.line}; border-radius: 10px; padding: 11px 13px; background: ${BRAND.surface}; }
.kpi-accent { background: ${BRAND.navy}; border-color: ${BRAND.navy}; }
.kpi-accent .kpi-label, .kpi-accent .kpi-sub { color: rgba(255,255,255,.72); }
.kpi-accent .kpi-value { color: #fff; }
.kpi-label { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: ${BRAND.muted}; }
.kpi-value { font-size: 19px; font-weight: 800; margin-top: 4px; color: ${BRAND.ink}; white-space: nowrap; }
.kpi-sub { font-size: 9.5px; color: ${BRAND.muted}; margin-top: 3px; }
.kpi-chip { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 20px; vertical-align: middle; margin-left: 2px; }
.kpi-chip.pos, .pos { color: ${BRAND.pos}; }
.kpi-chip.neg, .neg { color: ${BRAND.neg}; }
.kpi-chip.pos { background: rgba(18,135,90,.12); }
.kpi-chip.neg { background: rgba(214,69,69,.12); }

.sec { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 9px; }
.sec-t { font-size: 12.5px; font-weight: 800; color: ${BRAND.navy}; letter-spacing: .01em; }
.sec-n { font-size: 9.5px; color: ${BRAND.muted}; }

.card { border: 1px solid ${BRAND.line}; border-radius: 10px; padding: 14px; background: ${BRAND.surface}; break-inside: avoid; }
.card.flow { break-inside: auto; }
.grid2 { display: grid; grid-template-columns: 250px 1fr; gap: 16px; align-items: center; }
.grid-2c { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.row { display: flex; gap: 14px; }

table.tbl { width: 100%; border-collapse: collapse; font-size: 10px; }
table.tbl thead th { background: ${BRAND.paper}; color: ${BRAND.navy}; font-weight: 700; text-align: right;
  padding: 7px 8px; border-bottom: 1.5px solid ${BRAND.line}; font-size: 9px; letter-spacing: .03em; text-transform: uppercase; }
table.tbl thead th.l, table.tbl td.l { text-align: left; }
table.tbl tbody td { padding: 7px 8px; border-bottom: 1px solid ${BRAND.line}; text-align: right; }
table.tbl tbody tr:nth-child(even) { background: #FBFCFE; }
table.tbl tbody tr { break-inside: avoid; }
table.tbl tfoot td { padding: 8px; font-weight: 800; border-top: 2px solid ${BRAND.navy}; text-align: right; background: ${BRAND.paper}; }
table.tbl tfoot td.l { text-align: left; }
table.tbl tr.totalrow td { padding: 8px; font-weight: 800; border-top: 2px solid ${BRAND.navy}; text-align: right; background: ${BRAND.paper}; }
table.tbl tr.totalrow td.l { text-align: left; }
.scheme-name { font-weight: 600; color: ${BRAND.ink}; }
.scheme-sub { font-size: 8.5px; color: ${BRAND.muted}; }

.legend { display: flex; flex-direction: column; gap: 7px; }
.legend-row { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 8px; align-items: center; font-size: 10.5px; }
.legend-sw { width: 11px; height: 11px; border-radius: 3px; }
.legend-val { font-weight: 700; }
.legend-wt { color: ${BRAND.muted}; width: 42px; text-align: right; }

.badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
  background: rgba(0,174,239,.12); color: ${BRAND.navy}; }
.badge.risk { background: rgba(214,69,69,.12); color: ${BRAND.neg}; }
.badge.ok { background: rgba(18,135,90,.12); color: ${BRAND.pos}; }

.kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 10.5px; }
.kv .k { color: ${BRAND.muted}; }
.kv .v { font-weight: 600; text-align: right; }

.disclaimer { margin-top: 16px; padding: 10px 12px; background: ${BRAND.paper}; border: 1px solid ${BRAND.line};
  border-radius: 8px; font-size: 8.2px; line-height: 1.5; color: ${BRAND.muted}; break-inside: avoid; }
.page-break { break-before: page; }
.spacer { height: 14px; }
.muted { color: ${BRAND.muted}; }
.tiny { font-size: 9px; }
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

/** Footer for Puppeteer displayHeaderFooter with dynamic page numbering. */
export const footerTemplate = (reportName: string): string => `
<div style="font-family:'Inter',Arial,sans-serif;font-size:8px;color:#9AA3B5;width:100%;
     padding:0 12mm;display:flex;justify-content:space-between;align-items:center;">
  <span>Janta Nivesh &nbsp;·&nbsp; ${reportName}</span>
  <span>Confidential — for the named investor only</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

export const headerTemplate = '<div></div>';
