/**
 * eCAS Parser v2.0
 * ----------------------------------------------------------------------------
 * Parses Indian "Consolidated Account Statements" (eCAS) PDFs from:
 *   - CAMS         (Computer Age Management Services) – Mutual Fund standalone CAS
 *   - KFintech     (formerly Karvy/KFin)              – Mutual Fund standalone CAS
 *   - NSDL         (National Securities Depository)   – Demat + MF combined CAS
 *   - CDSL         (Central Depository Services)      – Demat + MF combined CAS
 *
 * CAMS/KFintech use a **positional** text layout (Folio No, scheme lines, etc.)
 * NSDL/CDSL use a **label-based** layout (AMC Name :, Scheme Name :, ISIN :, etc.)
 *
 * Output: normalised JSON payload following Account Aggregator / Sahamati style.
 *
 * Usage:
 *   import { parseEcas } from './ecas-parser.js';
 *   const json = await parseEcas('./statement.pdf', { password: 'ABCDE1234F' });
 *
 * Dependencies:
 *   npm i pdfjs-dist@3.11.174
 * ----------------------------------------------------------------------------
 */

import fs from 'fs';
import path from 'path';

// pdfjs-dist legacy build for Node.js (no canvas/worker needed)
// @ts-ignore – legacy build doesn't ship perfect types
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// TypeScript Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface ParseOpts {
  password?: string;
}

interface StatementPeriod {
  from: string | null;
  to: string | null;
}

interface Investor {
  name: string | null;
  email: string | null;
  mobile: string | null;
  pan: string | null;
  address: string | null;
  statementPeriod: StatementPeriod;
}

interface Transaction {
  date: string | null;
  description: string;
  amount: number | null;
  units: number | null;
  nav: number | null;
  unitBalance: number | null;
  type: string;
}

interface Scheme {
  schemeName: string | null;
  rtaCode: string | null;
  isin: string | null;
  ucc?: string | null;
  advisor: string | null;
  registrar: string;
  nominee?: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  costValue: number | null;
  nav: number | null;
  navDate: string | null;
  valuation: number | null;
  valuationDate: string | null;
  transactions: Transaction[];
}

interface Folio {
  amc: string | null;
  folioNumber: string;
  pan: string | null;
  kyc: string | null;
  schemes: Scheme[];
}

interface DematHolding {
  isin: string;
  name: string;
  quantity: number | null;
  marketPrice: number | null;
  value: number | null;
  assetClass: string;
}

interface DematAccount {
  depository: string;
  dpId: string | null;
  clientId: string | null;
  bo_id: string | null;
  holdings: DematHolding[];
  totalValue: number;
}

interface PortfolioSummaryEntry {
  name: string;
  costValue: number | null;
  marketValue: number | null;
}

interface PortfolioSummary {
  entries: PortfolioSummaryEntry[];
  totalCost: number | null;
  totalMarket: number | null;
}

interface PdfLoadResult {
  text: string;
  numPages: number;
  info: Record<string, any>;
}

type Issuer = 'CAMS' | 'KFINTECH' | 'NSDL' | 'CDSL' | 'UNKNOWN';

interface EcasPayload {
  schemaVersion: string;
  generatedAt: string;
  source: {
    issuer: Issuer;
    fileName: string | null;
    numPages: number;
    pdfInfo: Record<string, any>;
  };
  investor: Investor;
  portfolioSummary: PortfolioSummary;
  mutualFunds: {
    folios: Folio[];
    summary: { totalValuation: number; totalSchemes: number; totalCostValue: number };
  };
  demat: {
    accounts: DematAccount[];
    summary: { totalValue: number; totalAccounts: number; totalHoldings: number };
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Convert Indian format "1,23,456.78" → 123456.78 ; "(123.45)" → -123.45 */
function num(v: any): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || s === '-' || s === '--') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₹,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

/** Normalise dates to ISO-8601: DD-Mon-YYYY / DD/MM/YYYY / YYYY-MM-DD → YYYY-MM-DD */
function isoDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/))) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${yyyy}-${mm}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function clean(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Extract a label value: "Label : Something" → "Something" */
function labelVal(line: string, label: string): string | null {
  const re = new RegExp(label + '\\s*:\\s*(.+?)\\s*$', 'i');
  const m = line.match(re);
  return m ? clean(m[1]) : null;
}

/** Extract a label value from multi-line block, stopping at the next label */
function extractLabel(text: string, label: string): string | null {
  const re = new RegExp(label + '\\s*:\\s*(.+?)(?=\\n|$)', 'i');
  const m = text.match(re);
  return m ? clean(m[1]) : null;
}

function classifyTxn(desc: string | null, amount: number | null, units: number | null): string {
  const d = (desc || '').toLowerCase();
  if (d.includes('switch out') || d.includes('switch-out')) return 'SWITCH_OUT';
  if (d.includes('switch in') || d.includes('switch-in')) return 'SWITCH_IN';
  if (d.includes('redemption') || d.includes('redeem')) return 'REDEMPTION';
  if (d.includes('dividend') || d.includes('idcw') || d.includes('payout')) return 'DIVIDEND';
  if (d.includes('stt')) return 'STT';
  if (d.includes('stamp duty')) return 'STAMP_DUTY';
  if (d.includes('sip') || d.includes('systematic')) return 'SIP';
  if (d.includes('purchase') || d.includes('subscription') || (units != null && units > 0)) return 'PURCHASE';
  if (units != null && units < 0) return 'REDEMPTION';
  return 'OTHER';
}

function guessAssetClass(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('bond') || n.includes('debenture') || n.includes('ncd') || n.includes('govt') || n.includes('g-sec')) return 'DEBT';
  if (n.includes('etf')) return 'ETF';
  if (n.includes('reit')) return 'REIT';
  if (n.includes('invit')) return 'INVIT';
  if (n.includes('sgb') || n.includes('sovereign gold')) return 'GOLD_BOND';
  return 'EQUITY';
}


// ═══════════════════════════════════════════════════════════════════════════
// PDF LOADING (password-protected support via pdfjs-dist)
// ═══════════════════════════════════════════════════════════════════════════

async function loadPdfText(input: string | Buffer, password?: string): Promise<PdfLoadResult> {
  const data = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8,
    password: password || '',
    disableWorker: true,
    isEvalSupported: false,
  } as any);

  let doc: any;
  try {
    doc = await loadingTask.promise;
  } catch (err: any) {
    if (err && (err.name === 'PasswordException' || /password/i.test(err.message))) {
      throw new Error('PDF is password protected. Pass { password: "<PAN or PAN+DOB>" } to parseEcas().');
    }
    throw err;
  }

  const numPages: number = doc.numPages;
  const pages: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const linesByY = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!linesByY.has(y)) linesByY.set(y, []);
      linesByY.get(y)!.push({ x: item.transform[4], s: item.str });
    }
    const ys = [...linesByY.keys()].sort((a, b) => b - a);
    const pageText = ys
      .map((y) =>
        linesByY.get(y)!.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ').replace(/\s+/g, ' ').trim()
      )
      .filter(Boolean)
      .join('\n');
    pages.push(pageText);
  }

  const meta = await doc.getMetadata().catch(() => ({}));
  return {
    text: pages.join('\n'),
    numPages,
    info: (meta && meta.info) || {},
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// ISSUER DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function detectIssuer(text: string, info: Record<string, any>): Issuer {
  const t = text.toLowerCase();
  const title = ((info && info.Title) || '').toLowerCase();
  const author = ((info && info.Author) || '').toLowerCase();

  // CDSL CAS — title or body contains "Central Depository Services"
  if (title.includes('central depository') || t.includes('central depository services')) return 'CDSL';
  // NSDL CAS — title or body
  if (title.includes('national securities') || t.includes('national securities depository')) return 'NSDL';
  if (/\bnsdl\b/.test(t) && t.includes('consolidated account statement')) return 'NSDL';
  // KFintech standalone CAS
  if (t.includes('kfintech') || t.includes('karvy fintech') || author.includes('kfintech')) return 'KFINTECH';
  // CAMS standalone CAS
  if (author.includes('computer age') || (t.includes('cams') && t.includes('consolidated account statement'))) return 'CAMS';
  // Fallbacks
  if (/\bcdsl\b/.test(t) && t.includes('demat')) return 'CDSL';
  if (/\bnsdl\b/.test(t)) return 'NSDL';
  if (t.includes('folio no') && !t.includes('amc name')) return 'CAMS';
  if (t.includes('amc name') && t.includes('scheme name')) return 'CDSL'; // label-based = CDSL or NSDL
  return 'UNKNOWN';
}


// ═══════════════════════════════════════════════════════════════════════════
// COMMON INVESTOR HEADER PARSING
// ═══════════════════════════════════════════════════════════════════════════

function parseInvestorHeader(text: string, issuer: Issuer): Investor {
  const investor: Investor = {
    name: null,
    email: null,
    mobile: null,
    pan: null,
    address: null,
    statementPeriod: { from: null, to: null },
  };

  // Email
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) investor.email = email[0];

  // PAN — first PAN-shaped token (skip masked ones like "XXXXX1234X")
  const panAll = text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || [];
  investor.pan = panAll.find((p) => !/X{3,}/.test(p)) || panAll[0] || null;

  // Mobile
  const mobile = text.match(/(?:Mobile|Mob|Phone)[^\d]{0,10}(\+?\d[\d\s-]{8,14})/i);
  if (mobile) investor.mobile = mobile[1].replace(/\D/g, '');

  // Statement period
  const period = text.match(
    /(?:From|Period|Statement\s*Period)\s*[:\-]?\s*(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{2,4})\s*(?:To|to|-|–)\s*(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{2,4})/i
  );
  if (period) {
    investor.statementPeriod.from = isoDate(period[1]);
    investor.statementPeriod.to = isoDate(period[2]);
  }

  // Name — CDSL/NSDL often have "Name of Holder : NITIN KUMAR" or just a
  // prominent all-caps line near the top.
  const nameLabel = text.match(/(?:Name of (?:First )?Holder|Holder Name|Name)\s*:\s*([A-Z][A-Z .'-]+)/i);
  if (nameLabel) {
    investor.name = clean(nameLabel[1]);
  } else {
    const nameLine = text.split('\n').slice(0, 40).find(
      (l) => /^[A-Z][A-Z\s.&'-]{4,}$/.test(l.trim()) && !/STATEMENT|CONSOLIDATED|ACCOUNT|DEPOSITORY|SECURITIES|SUMMARY|PORTFOLIO|MUTUAL|SERVICES/i.test(l)
    );
    if (nameLine) investor.name = clean(nameLine);
  }

  return investor;
}


// ═══════════════════════════════════════════════════════════════════════════
// CAMS / KFintech PARSER (positional layout)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CAMS / KFintech standalone CAS uses positional layout:
 *   <AMC Name>
 *   Folio No: X  PAN: Y  KYC: OK  PAN: OK
 *   <holder name>
 *   <RTA code>-<Scheme Name> (Non-Demat) - ISIN: <ISIN>(Advisor: <ADV>)
 *   Registrar : CAMS
 *   Opening Unit Balance: X
 *   <transactions>
 *   NAV on <date>: INR X   Market Value on <date>: INR Y
 *   Closing Unit Balance: X   Total Cost Value: Y
 */
function parseCAMSKFin(text: string, issuer: Issuer): Folio[] {
  const folios: Folio[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const folioIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^Folio No\s*:/i.test(lines[i])) folioIdxs.push(i);
  }

  for (let k = 0; k < folioIdxs.length; k++) {
    const i = folioIdxs[k];
    const next = k + 1 < folioIdxs.length ? folioIdxs[k + 1] : lines.length;
    const blockLines = lines.slice(i, next);
    const blockText = blockLines.join(' ');
    const folioLine = lines[i];

    const folioNum = (folioLine.match(/Folio No\s*:\s*([A-Z0-9/\- ]+?)(?:\s+PAN:|\s*$)/i) || [])[1];
    const pan = (folioLine.match(/PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/) || [])[1];
    const kyc = (folioLine.match(/KYC\s*:\s*([A-Za-z]+)/) || [])[1];

    // AMC: walk up to find "...Mutual Fund" / "...Asset Management"
    let amc: string | null = null;
    for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
      if (/(Mutual Fund|Asset Management|AMC)\s*$/i.test(lines[j]) && !/^Total\b/i.test(lines[j]) && !/\d/.test(lines[j])) {
        amc = lines[j]; break;
      }
    }

    // Scheme header: concatenate lines after folio until "Registrar :"
    let schemeHeader = '';
    let headerEnd = i + 1;
    for (let j = i + 1; j < next && j < i + 12; j++) {
      schemeHeader += ' ' + lines[j];
      if (/Registrar\s*:/i.test(lines[j])) {
        if (j + 1 < next && /\)/.test(lines[j + 1]) && !/Unit Balance/i.test(lines[j + 1])) {
          schemeHeader += ' ' + lines[j + 1];
          headerEnd = j + 2;
        } else { headerEnd = j + 1; }
        break;
      }
    }
    schemeHeader = schemeHeader.replace(/\s+/g, ' ').trim();

    const regMatch = schemeHeader.match(/Registrar\s*:\s*([A-Za-z]+)/);
    const registrar = regMatch ? regMatch[1].toUpperCase() : issuer;

    const rtaMatch = schemeHeader.match(/\b([A-Z0-9]{3,10})\s*-\s*[A-Z][A-Za-z]/);
    const rtaCode = rtaMatch ? rtaMatch[1] : null;

    const isinMatch = schemeHeader.match(/ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{9}\d)/);
    const isin = isinMatch ? isinMatch[1] : null;

    // Advisor — may wrap across lines
    let advisor: string | null = null;
    const advMatch = schemeHeader.match(/Advisor\s*:\s*([A-Z0-9 .&-]+?)\s*\)/);
    if (advMatch) advisor = clean(advMatch[1]);
    if (!advisor && /Advisor\s*:/.test(schemeHeader)) {
      for (let j = i + 1; j < next && j < i + 14; j++) {
        const m = lines[j].match(/^([A-Z][A-Z0-9 .&-]*?)\)$/);
        if (m) { advisor = clean(m[1]); break; }
      }
    }

    let schemeName: string | null = null;
    if (rtaCode) {
      const after = schemeHeader.split(new RegExp(`\\b${rtaCode}\\s*-\\s*`))[1] || '';
      schemeName = clean(after.split(/\s*-\s*ISIN\s*:/i)[0]);
    } else {
      schemeName = clean((schemeHeader.split(/\s*-\s*ISIN\s*:/i)[0] || '').replace(/Registrar.*$/i, ''));
    }

    const openMatch = blockText.match(/Opening Unit Balance\s*:\s*([\d,.()\\-]+)/i);
    const closeMatch = blockText.match(/Closing Unit Balance\s*:\s*([\d,.()\\-]+)/i);
    const costMatch = blockText.match(/Total Cost Value\s*:\s*([\d,.()\\-]+)/i);
    const navMatch = blockText.match(/NAV on\s+([0-9A-Za-z\-/ ]+?)\s*:\s*INR\s*([\d,.]+)/i);
    const mvMatch = blockText.match(/Market Value on\s+([0-9A-Za-z\-/ ]+?)\s*:\s*INR\s*([\d,.]+)/i);

    const scheme: Scheme = {
      schemeName, rtaCode, isin, advisor, registrar,
      openingBalance: openMatch ? num(openMatch[1]) : null,
      closingBalance: closeMatch ? num(closeMatch[1]) : null,
      costValue: costMatch ? num(costMatch[1]) : null,
      nav: navMatch ? num(navMatch[2]) : null,
      navDate: navMatch ? isoDate(navMatch[1]) : null,
      valuation: mvMatch ? num(mvMatch[2]) : null,
      valuationDate: mvMatch ? isoDate(mvMatch[1]) : null,
      transactions: parseCAMSTxns(blockLines.slice(headerEnd - i)),
    };

    let folio = folios.find((f) => f.amc === amc && f.folioNumber === clean(folioNum || ''));
    if (!folio) {
      folio = { amc, folioNumber: clean(folioNum || ''), pan: pan || null, kyc: kyc || null, schemes: [] };
      folios.push(folio);
    }
    folio.schemes.push(scheme);
  }
  return folios;
}

/** Parse CAMS/KFintech transaction lines: <date> <desc> <amount> <units> <nav> <balance> */
function parseCAMSTxns(blockLines: string[]): Transaction[] {
  const out: Transaction[] = [];
  const dateRe = /^(\d{1,2}\s*-\s*[A-Za-z]{3}\s*-\s*\d{4})\b/;
  const numRe = /([\d,]+\.\d+|\([\d,]+\.\d+\))/g;

  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    const dm = line.match(dateRe);
    if (!dm) continue;
    if (/\*\*\*|Address|KRA/i.test(line)) continue;
    const nums = [...line.matchAll(numRe)].map((m) => m[0]);
    if (nums.length < 4) continue;
    const [amount, units, nav, balance] = nums.slice(-4);
    const descEnd = line.lastIndexOf(amount);
    const desc = clean(line.slice(dm[0].length, descEnd));
    const amt = num(amount);
    const unitsNum = num(units);
    out.push({
      date: isoDate(dm[1].replace(/\s*-\s*/g, '-')),
      description: desc,
      amount: amt, units: unitsNum, nav: num(nav), unitBalance: num(balance),
      type: classifyTxn(desc, amt, unitsNum),
    });
  }
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// CDSL / NSDL CAS PARSER (label-based layout)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CDSL/NSDL CAS PDFs use structured labels like:
 *   AMC Name : Axis Mutual Fund
 *   Scheme Name : Axis Small Cap Fund - Regular Growth
 *   Scheme Code : SCGP
 *   Folio No : 12345678
 *   ISIN : INF846K01K01
 *   UCC : MFAXIS0062
 *   RTA : KFIN / CAMS
 *   KYC of Investor/s : KYC OK
 *   Mobile No : XXXXXX2096
 *   Nominee : Registered
 *   Opening Balance : 100.123
 *   Closing Balance : 200.456
 *   NAV : 123.4567
 *   Valuation : 1,23,456.78
 *
 * Transactions appear as:
 *   <DD-Mon-YYYY> <description> <amount> <units> <NAV> <balance>
 *
 * Demat section uses:
 *   DP ID : IN300484
 *   BO ID : 1234567890123456
 *   ISIN / Name / Quantity / Market Price / Value rows
 */

function parseCDSL_NSDL(text: string, depository: Issuer): { mutualFunds: Folio[]; demat: DematAccount[] } {
  return {
    mutualFunds: parseCDSL_MF(text, depository),
    demat: parseCDSL_Demat(text, depository),
  };
}

/**
 * Parse the mutual fund section of a CDSL/NSDL CAS.
 * Strategy: split text into scheme blocks at "AMC Name :" markers.
 */
function parseCDSL_MF(text: string, depository: Issuer): Folio[] {
  const folios: Folio[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Find all "AMC Name :" line indices — each marks a new scheme block.
  const amcIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^AMC Name\s*:/i.test(lines[i])) amcIdxs.push(i);
  }

  for (let k = 0; k < amcIdxs.length; k++) {
    const start = amcIdxs[k];
    const end = k + 1 < amcIdxs.length ? amcIdxs[k + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    const blockText = blockLines.join('\n');

    // Extract labels from the block
    const amc = extractLabel(blockText, 'AMC Name');
    const schemeName = extractLabel(blockText, 'Scheme Name');
    const schemeCode = extractLabel(blockText, 'Scheme Code');
    const folioNo = extractLabel(blockText, 'Folio No');
    const isin = extractLabel(blockText, 'ISIN');
    const ucc = extractLabel(blockText, 'UCC');
    const rta = extractLabel(blockText, 'RTA');
    const kycRaw = extractLabel(blockText, 'KYC of Investor');
    const kyc = kycRaw ? kycRaw.replace(/KYC\s*/i, '').trim() : null;
    const nominee = extractLabel(blockText, 'Nominee');
    const pan = (blockText.match(/PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/) || [])[1] || null;

    // Balances
    const openRaw = extractLabel(blockText, 'Opening (?:Unit )?Balance');
    const closeRaw = extractLabel(blockText, 'Closing (?:Unit )?Balance');
    const navRaw = extractLabel(blockText, 'NAV(?:\\s*\\(Rs\\.?\\))?');
    const valRaw = extractLabel(blockText, 'Valuation(?:\\s*\\(INR\\))?');
    const costRaw = extractLabel(blockText, 'Cost Value');
    const marketRaw = extractLabel(blockText, 'Market Value');

    // NAV on date pattern for CDSL: "NAV on 28-Feb-2026 : 123.4567"
    const navDateMatch = blockText.match(/NAV\s+(?:as )?on\s+([0-9A-Za-z\-/ ]+?)\s*:\s*(?:INR\s*)?([\d,.]+)/i);
    const mvDateMatch = blockText.match(/(?:Market|Mkt)\s*Value\s+(?:as )?on\s+([0-9A-Za-z\-/ ]+?)\s*:\s*(?:INR\s*)?([\d,.]+)/i);

    // Transactions
    const transactions = parseCDSL_Txns(blockLines);

    const scheme: Scheme = {
      schemeName: schemeName || null,
      rtaCode: schemeCode || null,
      isin: isin || null,
      ucc: ucc || null,
      advisor: null,
      registrar: rta || depository,
      nominee: nominee || null,
      openingBalance: num(openRaw),
      closingBalance: num(closeRaw),
      costValue: num(costRaw),
      nav: navDateMatch ? num(navDateMatch[2]) : num(navRaw),
      navDate: navDateMatch ? isoDate(navDateMatch[1]) : null,
      valuation: mvDateMatch ? num(mvDateMatch[2]) : num(valRaw) || num(marketRaw),
      valuationDate: mvDateMatch ? isoDate(mvDateMatch[1]) : null,
      transactions,
    };

    // Group into folios
    let folio = folios.find((f) => f.amc === amc && f.folioNumber === (folioNo || ''));
    if (!folio) {
      folio = {
        amc, folioNumber: folioNo || '', pan, kyc, schemes: [],
      };
      folios.push(folio);
    }
    folio.schemes.push(scheme);
  }

  return folios;
}

/** Parse CDSL/NSDL transaction rows inside a scheme block */
function parseCDSL_Txns(blockLines: string[]): Transaction[] {
  const out: Transaction[] = [];
  // Date patterns: DD-Mon-YYYY or DD/MM/YYYY
  const dateRe = /^(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})\s+/;
  const numRe = /([\d,]+\.\d{2,}|\([\d,]+\.\d{2,}\))/g;

  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    const dm = line.match(dateRe);
    if (!dm) continue;
    // Skip labels masquerading as dated lines
    if (/AMC Name|Scheme Name|Folio No|ISIN|NAV on|Market Value|Opening|Closing/i.test(line)) continue;
    if (/\*\*\*/.test(line)) continue;

    const nums = [...line.matchAll(numRe)].map((m) => m[0]);
    if (nums.length < 2) continue; // need at least amount + units/balance

    // CDSL CAS transaction columns vary. Common: date | desc | amount | units | nav | balance
    // But some show fewer columns. We take the last N numbers.
    let amount: string | null = null, units: string | null = null, nav: string | null = null, balance: string | null = null;
    if (nums.length >= 4) {
      [amount, units, nav, balance] = nums.slice(-4);
    } else if (nums.length === 3) {
      [amount, units, balance] = nums.slice(-3);
    } else if (nums.length === 2) {
      [amount, balance] = nums.slice(-2);
    }

    const firstNumIdx = line.indexOf(nums[0]);
    const desc = clean(line.slice(dm[0].length, firstNumIdx));
    const amt = num(amount);
    const unitsNum = num(units);

    out.push({
      date: isoDate(dm[1]),
      description: desc,
      amount: amt,
      units: unitsNum,
      nav: num(nav),
      unitBalance: num(balance),
      type: classifyTxn(desc, amt, unitsNum),
    });
  }
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// CDSL / NSDL DEMAT HOLDINGS PARSER
// ═══════════════════════════════════════════════════════════════════════════

function parseCDSL_Demat(text: string, depository: Issuer): DematAccount[] {
  const accounts: DematAccount[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // If no explicit DP section, try to find a "DEMAT" holdings table
  // Look for ISIN-based holding rows anywhere in the text
  const dematAccount: DematAccount = {
    depository,
    dpId: null,
    clientId: null,
    bo_id: null,
    holdings: [],
    totalValue: 0,
  };

  // Extract DP/BO/Client IDs from anywhere
  const dpMatch = text.match(/DP\s*ID\s*:\s*([A-Z0-9]+)/i);
  if (dpMatch) dematAccount.dpId = dpMatch[1];
  const cidMatch = text.match(/Client\s*(?:Master\s*)?ID\s*:\s*([A-Z0-9]+)/i);
  if (cidMatch) dematAccount.clientId = cidMatch[1];
  const boMatch = text.match(/BO\s*ID\s*:\s*([0-9]{8,16})/i);
  if (boMatch) dematAccount.bo_id = boMatch[1];

  // Parse ISIN-based holding rows
  // Various formats:
  //   INE...01  RELIANCE INDUSTRIES  100  2,540.50  2,54,050.00
  //   ISIN: INE...01  Name: RELIANCE  Qty: 100  Price: 2540  Value: 254050
  const isinLineRe = /^([A-Z]{2}[A-Z0-9]{9}\d)\s+(.+?)\s+([\d,.()\-]+)\s+([\d,.()\-]+)\s+([\d,.()\-]+)\s*$/;

  for (const line of lines) {
    // Tabular ISIN row
    const m = line.match(isinLineRe);
    if (m) {
      dematAccount.holdings.push({
        isin: m[1], name: clean(m[2]),
        quantity: num(m[3]), marketPrice: num(m[4]), value: num(m[5]),
        assetClass: guessAssetClass(m[2]),
      });
      continue;
    }

    // Label-based ISIN holding (CDSL format)
    // Some CDSL CAS list holdings as:
    //   ISIN : INE... Security Name : ... Bal Qty : 100 Mkt Price : 2540 Value : 254050
    if (/ISIN\s*:\s*[A-Z]{2}/i.test(line)) {
      const isin2 = (line.match(/ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{9}\d)/) || [])[1];
      const name2 = (line.match(/(?:Security|Scrip)\s*(?:Name)?\s*:\s*(.+?)(?:\s+(?:Bal|Qty|Mkt|Value|Face))/i) || [])[1];
      const qty2 = (line.match(/(?:Bal|Free)\s*(?:Qty|Quantity|Balance)\s*:\s*([\d,.]+)/i) || [])[1];
      const price2 = (line.match(/(?:Mkt|Market)\s*(?:Price|Rate)\s*:\s*([\d,.]+)/i) || [])[1];
      const val2 = (line.match(/(?:Value|Mkt Value)\s*:\s*([\d,.]+)/i) || [])[1];
      if (isin2) {
        dematAccount.holdings.push({
          isin: isin2, name: clean(name2 || ''),
          quantity: num(qty2), marketPrice: num(price2), value: num(val2),
          assetClass: guessAssetClass(name2 || ''),
        });
      }
    }
  }

  // Also scan for multi-line demat holdings blocks:
  // "ISIN : INE...\nSecurity Name : ...\nBalance Quantity : 100\n..."
  const isinBlockRe = /ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{9}\d)/gi;
  const seen = new Set(dematAccount.holdings.map((h) => h.isin));
  let bm: RegExpExecArray | null;
  while ((bm = isinBlockRe.exec(text)) !== null) {
    if (seen.has(bm[1])) continue;
    // Look at lines around this match for labels
    const ctx = text.slice(bm.index, bm.index + 500);
    const secName = extractLabel(ctx, '(?:Security|Scrip)\\s*(?:Name)?');
    const balQty = extractLabel(ctx, '(?:Bal|Free|Available)\\s*(?:Qty|Quantity|Balance)');
    const mktPrice = extractLabel(ctx, '(?:Mkt|Market|Close)\\s*(?:Price|Rate)');
    const mktVal = extractLabel(ctx, '(?:Mkt\\s*)?Value');
    if (secName || balQty) {
      dematAccount.holdings.push({
        isin: bm[1], name: clean(secName || ''),
        quantity: num(balQty), marketPrice: num(mktPrice), value: num(mktVal),
        assetClass: guessAssetClass(secName || ''),
      });
      seen.add(bm[1]);
    }
  }

  dematAccount.totalValue = dematAccount.holdings.reduce((s, h) => s + (h.value || 0), 0);
  if (dematAccount.holdings.length || dematAccount.dpId || dematAccount.bo_id) {
    accounts.push(dematAccount);
  }
  return accounts;
}


// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO SUMMARY PARSER (CDSL/NSDL CAS top-level summary table)
// ═══════════════════════════════════════════════════════════════════════════

function parsePortfolioSummary(text: string): PortfolioSummary {
  const summary: PortfolioSummary = { entries: [], totalCost: null, totalMarket: null };
  // CAMS: "SBI Mutual Fund   50,000.00   69,381.89"
  // CDSL: summary table with AMC-wise cost/market
  const lines = text.split('\n');
  let inSummary = false;
  for (const line of lines) {
    if (/PORTFOLIO\s*SUMMARY/i.test(line)) { inSummary = true; continue; }
    if (inSummary) {
      if (/^Total\s/i.test(line.trim())) {
        const nums = [...line.matchAll(/([\d,]+\.\d+)/g)].map((m) => m[0]);
        if (nums.length >= 2) { summary.totalCost = num(nums[0]); summary.totalMarket = num(nums[1]); }
        inSummary = false; continue;
      }
      const m = line.trim().match(/^(.+?)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s*$/);
      if (m) {
        summary.entries.push({ name: clean(m[1]), costValue: num(m[2]), marketValue: num(m[3]) });
      }
    }
  }
  return summary;
}


// ═══════════════════════════════════════════════════════════════════════════
// TOP-LEVEL PARSER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param input  Path to PDF or Buffer.
 * @param opts
 * @param opts.password  PDF password (PAN, PAN+DOB, etc.)
 * @returns Normalised JSON payload.
 */
async function parseEcas(input: string | Buffer, opts: ParseOpts = {}): Promise<EcasPayload> {
  const { text, numPages, info } = await loadPdfText(input, opts.password);
  const issuer = detectIssuer(text, info);
  const investor = parseInvestorHeader(text, issuer);
  const portfolioSummary = parsePortfolioSummary(text);

  const payload: EcasPayload = {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    source: {
      issuer,
      fileName: typeof input === 'string' ? path.basename(input) : null,
      numPages,
      pdfInfo: info,
    },
    investor,
    portfolioSummary,
    mutualFunds: { folios: [], summary: { totalValuation: 0, totalSchemes: 0, totalCostValue: 0 } },
    demat: { accounts: [], summary: { totalValue: 0, totalAccounts: 0, totalHoldings: 0 } },
  };

  // ─── Dispatch to the correct parser based on issuer ───

  if (issuer === 'CAMS' || issuer === 'KFINTECH') {
    payload.mutualFunds.folios = parseCAMSKFin(text, issuer);
  }

  if (issuer === 'CDSL' || issuer === 'NSDL') {
    const result = parseCDSL_NSDL(text, issuer);
    payload.mutualFunds.folios = result.mutualFunds;
    payload.demat.accounts = result.demat;

    // Fallback: if the label-based parser found nothing, try CAMS-style too.
    // Some NSDL CAS PDFs use a hybrid layout.
    if (!payload.mutualFunds.folios.length) {
      payload.mutualFunds.folios = parseCAMSKFin(text, issuer);
    }
  }

  if (issuer === 'UNKNOWN') {
    // Try both parsers, keep whichever found more data
    const cams = parseCAMSKFin(text, 'UNKNOWN');
    const cdsl = parseCDSL_NSDL(text, 'UNKNOWN');
    const camsFolios = cams.length;
    const cdslFolios = cdsl.mutualFunds.length;
    if (cdslFolios >= camsFolios) {
      payload.mutualFunds.folios = cdsl.mutualFunds;
      payload.demat.accounts = cdsl.demat;
    } else {
      payload.mutualFunds.folios = cams;
    }
  }

  // ─── Compute summaries ───

  payload.mutualFunds.summary.totalSchemes = payload.mutualFunds.folios.reduce(
    (s, f) => s + f.schemes.length, 0
  );
  payload.mutualFunds.summary.totalValuation = payload.mutualFunds.folios.reduce(
    (s, f) => s + f.schemes.reduce((ss, sc) => ss + (sc.valuation || 0), 0), 0
  );
  payload.mutualFunds.summary.totalCostValue = payload.mutualFunds.folios.reduce(
    (s, f) => s + f.schemes.reduce((ss, sc) => ss + (sc.costValue || 0), 0), 0
  );
  payload.demat.summary.totalAccounts = payload.demat.accounts.length;
  payload.demat.summary.totalHoldings = payload.demat.accounts.reduce(
    (s, a) => s + a.holdings.length, 0
  );
  payload.demat.summary.totalValue = payload.demat.accounts.reduce(
    (s, a) => s + (a.totalValue || 0), 0
  );

  return payload;
}


// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  parseEcas,
  // Exported for tests / advanced users
  detectIssuer,
  parseInvestorHeader,
  parseCAMSKFin,
  parseCDSL_NSDL,
  parseCDSL_MF,
  parseCDSL_Demat,
  parseCDSL_Txns,
  parseCAMSTxns,
  parsePortfolioSummary,
  num,
  isoDate,
  clean,
};

// Re-export types
export type {
  EcasPayload,
  Investor,
  Folio,
  Scheme,
  Transaction,
  DematAccount,
  DematHolding,
  PortfolioSummary,
  Issuer,
};
