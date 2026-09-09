/** Formatting helpers — Indian numbering, currency, dates, masking. */

const inrGroup = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrGroup2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹ with Indian grouping, no decimals (for headline amounts). */
export const inr = (n: number | string | undefined | null): string =>
    '₹' + inrGroup.format(Math.round(Number(n) || 0));

/** ₹ with 2 decimals (for precise/table amounts). */
export const inr2 = (n: number | string | undefined | null): string =>
    '₹' + inrGroup2.format(Number(n) || 0);

/** Compact ₹ in lakh/crore for KPI tiles. */
export function inrCompact(n: number | string | undefined | null): string {
    const numVal = Number(n) || 0;
    const abs = Math.abs(numVal);
    if (abs >= 1e7) return '₹' + (numVal / 1e7).toFixed(2) + ' Cr';
    if (abs >= 1e5) return '₹' + (numVal / 1e5).toFixed(2) + ' L';
    return inr(numVal);
}

/** Plain number with Indian grouping + fixed decimals. */
export const num = (n: number | string | undefined | null, d = 3): string =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);

/** Signed percentage, 2 dp (e.g. +18.40%). */
export const pct = (n: number | string | undefined | null, d = 2): string =>
    (Number(n) >= 0 ? '+' : '') + (Number(n) || 0).toFixed(d) + '%';

/** Unsigned/plain percentage (e.g. 18.40%). */
export const pctPlain = (n: number | string | undefined | null, d = 2): string =>
    (Number(n) || 0).toFixed(d) + '%';

/** Date: 2026-08-31 → 31 Aug 2026 */
export function fmtDate(iso: string | undefined | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Month: 2026-08 → Aug '26 */
export function fmtMonth(ym: string | undefined | null): string {
    if (!ym) return '—';
    const parts = ym.split('-');
    if (parts.length < 2) return ym;
    const [y, m] = parts;
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'short' }) + " '" + String(y).slice(2);
}

/** ABCPK3751L → ABCPK****L */
export const maskPan = (p: string | undefined | null): string =>
    (p ? p.slice(0, 5) + '****' + p.slice(-1) : '—');

/** Sign class for +/- colouring: 'pos' | 'neg' | 'zero' */
export const signClass = (n: number | string | undefined | null): string =>
    (Number(n) > 0 ? 'pos' : Number(n) < 0 ? 'neg' : 'zero');
