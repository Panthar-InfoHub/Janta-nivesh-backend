import type { VelvetReportViewData, VelvetReportGoal } from "./fire-report.transformer.js";
import type { YearlyGoalRequirement } from "./fire-report.types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const NAVY = "#1E3A5F";
const GOLD = "#D4A574";
const GREEN = "#22C55E";
const RED = "#EF4444";
const GRAY = "#6B7280";
const PAGE_WIDTH_MM = 230;
const PAGE_HEIGHT_MM = 330;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function fontB64(filename: string): string {
  const buf = fs.readFileSync(path.join(__dirname, "fonts", filename));
  return buf.toString("base64");
}

const fmt_cr = (v: number): string =>
  v >= 10_000_000 ? `${(v / 10_000_000).toFixed(2)} Cr` : `${(v / 100_000).toFixed(1)} L`;

const fmt_in = (v: number): string =>
  v >= 100_000 ? `${(v / 100_000).toFixed(2)} L` : `${v.toLocaleString("en-IN")}`;

const pct = (v: number): string => `${v.toFixed(1)}%`;

const rs = (val: string, color = "#111827", size = "inherit") =>
  `<span style="color:${color};font-size:${size};font-family:'NotoSansBold',sans-serif;font-weight:normal;">&#x20B9;</span>${val}`;

function header(quarter: string, name: string, age: number, city: string): string {
  return `
    <div class="page-header">
      <div class="header-left">
        <div class="logo">VI</div>
        <div>
          <div class="brand-name">Velvet Investing</div>
          <div class="brand-sub">Wealth Health Report &bull; ${quarter}</div>
        </div>
      </div>
      <div class="header-right">
        <div class="client-name">${name}</div>
        <div class="client-sub">Age ${age} &bull; ${city}</div>
      </div>
    </div>`;
}

function footer(pageNum: number): string {
  return `
    <div class="page-footer">
      <span>Confidential - For Client Use Only</span>
      <span>Page ${pageNum} of 6</span>
    </div>`;
}

function sparkline(
  data: { label: string; value: number }[],
  color: string,
  width = 430,
  height = 100,
  showYAxis = false
): string {
  if (data.length < 2) return "";
  const PAD_L = showYAxis ? 52 : 12;
  const PAD_R = 12;
  const TOP = 10;
  const BOT = 22;
  const chartW = width - PAD_L - PAD_R;
  const chartH = height - TOP - BOT;
  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const px = (i: number) => PAD_L + (i / (data.length - 1)) * chartW;
  const py = (v: number) => TOP + (1 - (v - minV) / range) * chartH;
  const pts = data.map((d, i) => `${px(i).toFixed(1)},${py(d.value).toFixed(1)}`).join(" ");
  const fmt = (v: number) => `${Math.round(v)} L`;
  const yTicks = [minV, minV + range / 2, maxV];
  const gridLines = [0, 0.5, 1].map(t => {
    const y = (TOP + (1 - t) * chartH).toFixed(1);
    return `<line x1="${PAD_L}" y1="${y}" x2="${width - PAD_R}" y2="${y}" stroke="#E5E7EB" stroke-width="0.5"/>`;
  }).join("");
  const dots = data.map((d, i) =>
    `<circle cx="${px(i).toFixed(1)}" cy="${py(d.value).toFixed(1)}" r="3" fill="${color}"/>`
  ).join("");
  const xLabels = data.map((d, i) =>
    `<text x="${px(i).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="8" fill="${GRAY}">${d.label}</text>`
  ).join("");
  const yLabels = showYAxis
    ? [...yTicks].reverse().map((tv, i) => {
      const y = (TOP + i * (chartH / 2)).toFixed(1);
      return `<text x="${PAD_L - 4}" y="${y}" text-anchor="end" font-size="8" fill="${GRAY}" dominant-baseline="middle">${fmt(tv)}</text>`;
    }).join("")
    : "";
  return `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="display:block;margin-top:6px">
      ${gridLines}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>${dots}${xLabels}${yLabels}
    </svg>`;
}

function pieChart(data: { name: string; value: number; percentage: number }[], size = 140): string {
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const PIE_COLORS = [NAVY, GRAY, GOLD, GREEN];
  const slices = data.filter(d => d.value > 0);
  let cumAngle = -90;
  const paths = slices.map((slice, i) => {
    const angle = (slice.percentage / 100) * 360;
    const s = (cumAngle * Math.PI) / 180;
    const e = ((cumAngle + angle) * Math.PI) / 180;
    cumAngle += angle;
    const color = PIE_COLORS[i % PIE_COLORS.length]!;
    return {
      d: `M${cx},${cy} L${(cx + r * Math.cos(s)).toFixed(2)},${(cy + r * Math.sin(s)).toFixed(2)} A${r},${r} 0 ${angle > 180 ? 1 : 0} 1 ${(cx + r * Math.cos(e)).toFixed(2)},${(cy + r * Math.sin(e)).toFixed(2)} Z`,
      color, name: slice.name, pct: slice.percentage
    };
  });
  const legend = paths.map(p =>
    `<div style="display:flex;align-items:center;gap:4px;font-size:9px;color:${GRAY}">
           <div style="width:8px;height:8px;background:${p.color};border-radius:2px;flex-shrink:0"></div>
           <span>${p.name}: ${p.pct}%</span>
         </div>`
  ).join("");
  return `<div style="display:flex;flex-direction:column;align-items:center">
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        ${paths.map(p => `<path d="${p.d}" fill="${p.color}"/>`).join("")}
      </svg>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:6px;max-width:${size + 60}px">${legend}</div>
    </div>`;
}

function barChart(have: number, recommended: number, haveColor: string, recColor: string, unit: "Cr" | "L"): string {
  const W = 250, H = 145, PAD_L = 50, PAD_B = 28, PAD_T = 10;
  const chartW = W - PAD_L - 12, chartH = H - PAD_B - PAD_T;
  const maxVal = Math.max(have, recommended, 1);
  const roughStep = maxVal / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
  const normalized = roughStep / magnitude;
  const stepMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = stepMultiplier * magnitude;
  const axisMax = Math.max(step * 2, Math.ceil(maxVal / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= axisMax + step * 0.001; v += step) ticks.push(v);

  const barW = chartW / 4, gap = chartW / 6;
  const haveH = (have / axisMax) * chartH, recH = (recommended / axisMax) * chartH;
  const haveX = PAD_L + gap, recX = PAD_L + gap + barW + gap;
  const fmt = (v: number) => {
    if (unit === "Cr") return `${(v / 10_000_000).toFixed(1)} Cr`;
    return `${(v / 100_000).toFixed(v >= 10_00_000 ? 0 : 1)} L`;
  };
  const gridLines = ticks.map(tv => {
    const y = PAD_T + chartH - (tv / axisMax) * chartH;
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - 12}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="0.5"/>
                <text x="${PAD_L - 4}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="${GRAY}">${fmt(tv)}</text>`;
  }).join("");
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="display:block">
      ${gridLines}
      <rect x="${haveX.toFixed(1)}" y="${(PAD_T + chartH - haveH).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(haveH, 0).toFixed(1)}" fill="${haveColor}" rx="2"/>
      <rect x="${recX.toFixed(1)}" y="${(PAD_T + chartH - recH).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(recH, 0).toFixed(1)}" fill="${recColor}" rx="2"/>
      <text x="${(haveX + barW / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="${GRAY}">Current</text>
      <text x="${(recX + barW / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="${GRAY}">Recommended</text>
    </svg>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
function getCSS(regularB64: string, boldB64: string): string {
  return `
    /* 1. FONT DEFINITIONS: Use unique family for bold to guarantee results */
    @font-face {
        font-family: 'NotoSans';
        src: url('data:font/truetype;base64,${regularB64}') format('truetype'); 
        font-weight: 400; 
        font-style: normal; 
    }
    @font-face { 
        font-family: 'NotoSansBold'; 
        src: url('data:font/truetype;base64,${boldB64}') format('truetype'); 
        font-weight: 400; /* File is already bold; 400 avoids 'double bolding' */
        font-style: normal; 
    }

    /* 2. BASE RESET & PRINT SETTINGS */
    @page { size: ${PAGE_WIDTH_MM}mm ${PAGE_HEIGHT_MM}mm; margin: 0; }
    * { 
        box-sizing: border-box; 
        margin: 0; 
        padding: 0; 
        -webkit-print-color-adjust: exact !important; 
        print-color-adjust: exact !important;
    }
    
    body { 
        font-family: 'NotoSans', sans-serif; 
        font-size: 9px; 
        color: #111827; /* Darker black for high contrast */
        background: white; 
        -webkit-font-smoothing: antialiased;
    }

    /* 3. CRITICAL BOLDNESS OVERRIDES */
    b, strong, .bold, th { 
        font-family: 'NotoSansBold' !important; 
        font-weight: normal !important; 
        color: inherit;
    }

    /* Force specific high-impact elements to use the Bold family */
    .brand-name, .logo, .page-title, .section-title, .card-value, .tile-value, .summary-title, .val, .kpi-value, .metric-value {
        font-family: 'NotoSansBold' !important;
        font-weight: normal !important;
    }

    /* Catch-all for any inline styles or legacy weight tags */
    [style*="font-weight:bold"], [style*="font-weight: bold"], [style*="font-weight:700"] {
        font-family: 'NotoSansBold' !important;
        font-weight: normal !important;
    }

    /* 4. LAYOUT & STRUCTURE */
    .page {
      width: ${PAGE_WIDTH_MM}mm; height: ${PAGE_HEIGHT_MM}mm;
      padding: 14mm 14mm 28mm 14mm;
      position: relative; overflow: hidden;
      page-break-after: always;
      display: flex; flex-direction: column;
    }
    .page:last-child { page-break-after: avoid; }

    .page-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .page-body-with-footnotes { padding-bottom: 22mm; }

    .row2-fill { display: flex; gap: 10px; flex: 1; min-height: 0; margin-bottom: 10px; }
    .row2-fill > * { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .row2-fill .card { flex: 1; }

    .page-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${GOLD}; padding-bottom: 8px; margin-bottom: 12px; flex-shrink: 0; }
    .header-left { display: flex; align-items: center; gap: 10px; }
    .logo { width: 34px; height: 34px; background: ${NAVY}; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; }
    .brand-name { font-size: 12px; color: ${NAVY}; }
    .brand-sub { font-size: 8px; color: ${GRAY}; }
    .header-right { text-align: right; }
    .client-name { font-size: 10px; color: ${NAVY}; }
    .client-sub { font-size: 8px; color: ${GRAY}; }

    .page-footer { position: absolute; bottom: 10mm; left: 14mm; right: 14mm; display: flex; justify-content: space-between; border-top: 1px solid #E5E7EB; padding-top: 4px; font-size: 8px; color: ${GRAY}; }

    .footnotes-block { position: absolute; bottom: 18mm; left: 14mm; right: 14mm; border-top: 0.5px solid #E5E7EB; padding-top: 4px; }
    .fn { font-size: 7px; color: #4B5563; margin-top: 2px; line-height: 1.4; padding-left: 12px; text-indent: -12px; }
    .fn_1 { font-size: 10px; color: #4B5563; margin-top: 2px; line-height: 1.4; padding-left: 12px; text-indent: -12px; }

    .page-title { font-size: 18px; color: ${NAVY}; margin-bottom: 6px; flex-shrink: 0; }
    .insight { font-size: 9px; color: #374151; margin-bottom: 10px; flex-shrink: 0; line-height: 1.5; background: #F9FAFB; border-left: 3px solid ${GOLD}; padding: 8px 10px; border-radius: 0 4px 4px 0; }
    .section-title { font-size: 12px; color: ${NAVY}; margin: 8px 0 5px; flex-shrink: 0; }

    .row2 { display: flex; gap: 10px; margin-bottom: 10px; flex-shrink: 0; }
    .row2 > * { flex: 1; min-width: 0; }

    .card { background: white; border: 1px solid #E5E7EB; border-radius: 6px; padding: 10px; }
    .card-label { font-size: 8px; color: ${GRAY}; margin-bottom: 4px; }
    .card-value { font-size: 24px; color: ${NAVY}; }
    .card-sub { font-size: 8px; color: ${GRAY}; margin-top: 4px; }

    .badge-pos { display: inline-block; background: #DCFCE7; color: #15803D; font-size: 8px; padding: 2px 6px; border-radius: 10px; }
    .badge-neg { display: inline-block; background: #FEE2E2; color: #B91C1C; font-size: 8px; padding: 2px 6px; border-radius: 10px; }

    .tiles { display: flex; gap: 8px; margin-bottom: 6px; }
    .tile { flex: 1; text-align: center; padding: 8px; background: white; border: 1px solid #E5E7EB; border-radius: 6px; }
    .tile-label { font-size: 8px; color: ${GRAY}; margin-bottom: 2px; }
    .tile-value { font-size: 16px; }

    .progress-bg { height: 12px; background: #E5E7EB; border-radius: 6px; width: 100%; margin: 6px 0; }
    .progress-fill { height: 12px; border-radius: 6px; background: ${NAVY}; }

    .tbl { width: 100%; border-collapse: collapse; flex-shrink: 0; }
    .tbl thead tr { background: #F9FAFB; border-bottom: 2px solid #D1D5DB; }
    .tbl th { font-size: 8px; padding: 6px 4px; color: #111827; text-align: left; }
    .tbl td { font-size: 8px; padding: 5px 4px; color: #111827; border-bottom: 0.5px solid #E5E7EB; }
    .tbl tr:nth-child(even) td { background: #FAFAFA; }
    .tbl .text-right { text-align: right; }
    .tbl-tight td { padding: 3px 4px !important; font-size: 9px !important; color: #111827 !important; }
    .tbl-tight th { padding: 3px 4px !important; font-size: 10px !important; }
    .tbl .green { color: ${GREEN}; font-weight: bold; }

    .metric-row { display: flex; justify-content: space-between; padding: 2px 0; }
    .metric-label { font-size: 8px; color: ${GRAY}; }
    .metric-value { font-size: 8px; color: #1F2937; }
    .divider { border-bottom: 0.5px solid #E5E7EB; margin: 6px 0; }

    .ins-box { flex: 1; border-radius: 6px; padding: 8px; }
    .summary-box { background: ${NAVY}; border-radius: 6px; padding: 14px; color: white; flex-shrink: 0; }
    .summary-title { font-size: 10px; margin-bottom: 10px; }
    .summary-grid { display: flex; justify-content: space-between; }
    .summary-item .sub { font-size: 8px; opacity: 0.8; }
    .summary-item .val { font-size: 14px; }

    .kpi-strip { display: flex; gap: 8px; flex-shrink: 0; }
    .kpi-strip > div { flex: 1; background: #F3F4F6; border-radius: 6px; padding: 10px; text-align: center; }
    .kpi-label { font-size: 8px; color: ${GRAY}; margin-bottom: 3px; }
    .kpi-value { font-size: 13px; }

    .spacer { flex: 1; }

    @media print { .page { page-break-after: always; } .page:last-child { page-break-after: avoid; } }
    `;
}

// ─── Page 1: Financial Overview ───────────────────────────────────────────────
function page1(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, snapshot, qoqChanges } = data;
  const nwPos = parseFloat(qoqChanges.netWorth) >= 0;
  const firePos = parseFloat(qoqChanges.firePercent) >= 0;
  const fireBarW = Math.min(snapshot.firePercentage, 100);
  const page1CardBg = "#F3F4F6";
  const page1CardBorder = "#E7E9EE";
  const nwHistory = snapshot.netWorthHistory.map(h => ({ label: h.quarter, value: h.value }));
  const fireHistory = snapshot.fireHistory.map(h => ({ label: h.quarter, value: h.fire / 100_000 }));

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}

    <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-height:0">

      <div style="flex-shrink:0">
        <div class="page-title">Financial Overview (Quarterly)</div>
        <div class="insight"><b>Executive Insight:</b> Net worth ${nwPos ? "grew" : "declined"} ${Math.abs(parseFloat(qoqChanges.netWorth))}% QoQ to ${rs(fmt_cr(snapshot.netWorth), NAVY)} with steady financial asset accumulation at age ${clientData.age}.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">
        <div style="display:flex;gap:10px;flex:1;min-height:0;align-items:stretch">
          <div class="card" style="flex:1;display:flex;flex-direction:column;padding:14px;text-align:center;background:${page1CardBg};border:1px solid ${page1CardBorder}">
            <div class="card-label" style="font-size:10px;text-align:left">Current Net Worth</div>
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0">
              <div style="font-size:52px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY};line-height:1">${rs(fmt_cr(snapshot.netWorth), NAVY, "44px")}</div>
              <span class="${nwPos ? "badge-pos" : "badge-neg"}" style="font-size:9px;padding:3px 10px;margin-top:8px">${nwPos ? "↑" : "↓"} ${Math.abs(parseFloat(qoqChanges.netWorth)).toFixed(1)}%</span>
            </div>
            <div style="font-size:8.5px;color:${GRAY};margin-top:4px">Previous Quarter: ${rs(fmt_cr(snapshot.netWorthPrevQ), GRAY, "8px")}</div>
            <div style="font-size:8px;color:${GRAY};margin-top:3px">Absolute Increase: ${rs(fmt_cr(snapshot.netWorth - snapshot.netWorthPrevQ), GRAY, "7.5px")}</div>
          </div>
          <div class="card" style="flex:1;display:flex;flex-direction:column;padding:14px;background:${page1CardBg};border:1px solid ${page1CardBorder}">
            <div class="card-label" style="font-size:10px">Current FIRE<sup>1</sup> Status</div>
            <div style="display:flex;gap:10px;margin-top:6px">
              <div style="flex:1">
                <div style="font-size:8px;color:${GRAY}">FIRE Number<sup>2</sup></div>
                <div style="font-size:30px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY};margin-top:2px;line-height:1">${rs(fmt_cr(snapshot.fireNumber), NAVY, "23px")}</div>
              </div>
              <div style="flex:1">
                <div style="font-size:8px;color:${GRAY}">FIRE %<sup>3</sup></div>
                <div style="font-size:30px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GOLD};margin-top:2px;line-height:1">${pct(snapshot.firePercentage)}</div>
              </div>
              <div style="flex:1">
                <div style="font-size:8px;color:${GRAY}">Gap<sup>4</sup></div>
                <div style="font-size:30px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${RED};margin-top:2px;line-height:1">${rs(fmt_cr(snapshot.fireGap), RED, "23px")}</div>
              </div>
            </div>
            <div style="margin-top:8px">
              <div class="progress-bg"><div class="progress-fill" style="width:${fireBarW}%"></div></div>
              <div style="font-size:8.5px;color:${GRAY};margin-top:8px">Annual Expenses: ${rs(fmt_cr(snapshot.annualExpenses), GRAY, "8px")}</div>
              <div style="font-size:8.5px;color:${GRAY};margin-top:2px">Monthly: ${rs(fmt_in(snapshot.monthlyExpenses), GRAY, "8px")}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex:1;min-height:0;align-items:stretch">
          <div class="card" style="flex:1;display:flex;flex-direction:column;padding:12px;background:${page1CardBg};border:1px solid ${page1CardBorder}">
            <div class="card-label" style="font-size:10px">QoQ Net Worth Change<sup>5</sup></div>
            <div style="font-size:48px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${nwPos ? GREEN : RED};margin-top:2px;line-height:1">${nwPos ? "+" : ""}${qoqChanges.netWorth}%</div>
            <div style="font-size:9px;color:${GRAY};margin-top:4px">Quarter over Quarter</div>
            <div style="height:112px;margin-top:6px">${sparkline(nwHistory, GREEN, 430, 112)}</div>
            ${nwHistory.length >= 2 ? `<div style="font-size:8px;color:${GRAY};margin-top:4px">${nwHistory[nwHistory.length - 2]!.label}: ${rs(fmt_cr(nwHistory[nwHistory.length - 2]!.value * 100_000), GRAY, "7px")} &rarr; ${nwHistory[nwHistory.length - 1]!.label}: ${rs(fmt_cr(nwHistory[nwHistory.length - 1]!.value * 100_000), GRAY, "7px")}</div>` : ""}
          </div>
          <div class="card" style="flex:1;display:flex;flex-direction:column;padding:12px;background:${page1CardBg};border:1px solid ${page1CardBorder}">
            <div class="card-label" style="font-size:10px">QoQ FIRE Score Change<sup>6</sup></div>
            <div style="font-size:48px;font-weight:700;font-family:'NotoSansBold','NotoSans',sans-serif;color:${firePos ? GOLD : RED};margin-top:2px;line-height:1">${firePos ? "+" : ""}${qoqChanges.firePercent}%</div>
            <div style="font-size:9px;color:${GRAY};margin-top:4px">FIRE % Improvement</div>
            <div style="height:112px;margin-top:6px">${sparkline(fireHistory, GOLD, 430, 112)}</div>
            ${snapshot.fiYear
      ? `<div style="font-size:8px;color:${GRAY};margin-top:4px">Projected FI: Year ${snapshot.fiYear} (Age ${snapshot.fiAge})</div>`
      : ""}
          </div>
        </div>
      </div>

      <!-- Footnotes pinned at bottom, never compressed -->
      <div style="flex-shrink:0;border-top:0.5px solid #E5E7EB;padding-top:5px">
        <div class="fn_1"><sup>1</sup><b>FIRE:</b> Financial Independence, Retire Early &mdash; Corpus needed to sustain current lifestyle without active income</div>
        <div class="fn_1"><sup>2</sup><b>FIRE Number:</b> Annual Expenses &times; 30 (based on 4% safe withdrawal rate) = ${rs(fmt_cr(snapshot.annualExpenses), "#111", "7px")} &times; 30 = ${rs(fmt_cr(snapshot.fireNumber), "#111", "7px")} (adjusted to ${rs(fmt_cr(snapshot.fireNumber), "#111", "7px")} for inflation-adjusted future expenses)</div>
        <div class="fn_1"><sup>3</sup><b>FIRE %:</b> (Current Net Worth / FIRE Number) &times; 100 = (${rs(fmt_cr(snapshot.netWorth), "#111", "7px")} / ${rs(fmt_cr(snapshot.fireNumber), "#111", "7px")}) &times; 100 = ${snapshot.firePercentage.toFixed(1)}%</div>
        <div class="fn_1"><sup>4</sup><b>Gap:</b> FIRE Number &minus; Current Net Worth = ${rs(fmt_cr(snapshot.fireNumber), "#111", "7px")} &minus; ${rs(fmt_cr(snapshot.netWorth), "#111", "7px")} = ${rs(fmt_cr(snapshot.fireGap), "#111", "7px")}</div>
        <div class="fn_1"><sup>5</sup><b>QoQ Net Worth Change:</b> ((Current NW &minus; Previous NW) / Previous NW) &times; 100 = ((${rs(fmt_cr(snapshot.netWorth), "#111", "7px")} &minus; ${rs(fmt_cr(snapshot.netWorthPrevQ), "#111", "7px")}) / ${rs(fmt_cr(snapshot.netWorthPrevQ), "#111", "7px")}) &times; 100 = ${qoqChanges.netWorth}%</div>
        <div class="fn_1"><sup>6</sup><b>QoQ FIRE Score Change:</b> Current FIRE % &minus; Previous FIRE % = ${qoqChanges.firePercent} percentage points</div>
        <div class="fn_1">* Data marked with asterisk represents estimated values</div>
      </div>

    </div>

    ${footer(1)}
  </div>`;
}

// ─── Page 2: FIRE Calculations ────────────────────────────────────────────────
function page2(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, snapshot, thirtyYearProjection } = data;
  const fireBarW = Math.min(snapshot.firePercentage, 100);

  const rows = thirtyYearProjection.map((row) => `
      <tr>
        <td class="bold">${row.year}</td>
        <td class="text-right">${rs(fmt_cr(row.portfolioValue), "#374151", "8px")}</td>
        <td class="text-right">${rs(fmt_in(row.expenses), "#374151", "8px")}</td>
        <td class="text-right">${row.goals > 0 ? rs(fmt_in(row.goals), "#374151", "8px") : "&mdash;"}</td>
        <td class="text-right">${rs(fmt_cr(row.fireNumber), "#374151", "8px")}</td>
        <td class="text-right ${row.firePercent >= 100 ? "green bold" : ""}">${pct(row.firePercent)}</td>
      </tr>`).join("");

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}
    <div class="page-body page-body-with-footnotes">
      <div class="page-title">F.I.R.E Calculations</div>
      <div class="insight"><b>Executive Insight:</b> Current FIRE progress at ${pct(snapshot.firePercentage)}${snapshot.fiYear ? ` with projected financial independence by ${snapshot.fiYear} (age ${snapshot.fiAge}).` : ". Keep building your corpus consistently."}</div>

      <div class="card" style="margin-bottom:10px;flex-shrink:0">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;align-items:flex-end">
          <div>
            <div class="metric-label">Current Portfolio</div>
            <div style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${rs(fmt_cr(snapshot.fireCurrentCorpus), NAVY, "13px")}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GOLD}">${pct(snapshot.firePercentage)}</div>
            <div class="metric-label">FIRE Progress</div>
          </div>
          <div style="text-align:right">
            <div class="metric-label">FIRE Target</div>
            <div style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${RED}">${rs(fmt_cr(snapshot.fireNumber), RED, "13px")}</div>
          </div>
        </div>
        <div class="progress-bg"><div class="progress-fill" style="width:${fireBarW}%;background:linear-gradient(to right,#3B82F6,${GREEN})"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <div style="font-size:7px;color:${GRAY}">Gap: ${rs(fmt_cr(snapshot.fireGap), GRAY, "7px")}</div>
          <div style="font-size:7px;color:${GRAY}">Annual Expenses: ${rs(fmt_cr(snapshot.annualExpenses), GRAY, "7px")}</div>
        </div>
      </div>

      ${snapshot.fiYear ? `<div style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY};margin-bottom:6px;flex-shrink:0">Projected FI in Year ${snapshot.fiYear} at FIRE % &ge; 100% (Age ${snapshot.fiAge})</div>` : ""}

      <div style="flex:1;min-height:0;display:flex;flex-direction:column">
        <table class="tbl tbl-tight" style="height:100%">
          <thead>
            <tr>
              <th style="width:9%">Year</th>
              <th class="text-right" style="width:19%">Portfolio Value</th>
              <th class="text-right" style="width:16%">Expenses</th>
              <th class="text-right" style="width:15%">Goal Payouts</th>
              <th class="text-right" style="width:19%">FIRE Number</th>
              <th class="text-right" style="width:10%">FIRE %</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="footnotes-block">
      <div class="fn"><b>7. Portfolio Value:</b> Total investable assets at the beginning of each year</div>
      <div class="fn"><b>8. Total Expenses:</b> Projected annual expenses adjusted for 6% inflation</div>
      <div class="fn"><b>9. Goal Payouts:</b> Lump-sum goal funding due that year</div>
      <div class="fn"><b>10. FIRE Number:</b> Annual Expenses &times; 30 (based on 4% safe withdrawal rate)</div>
      <div class="fn"><b>11. FIRE %:</b> (Current Portfolio Value / FIRE Number) &times; 100</div>
      <div class="fn"><b>12. Safe Withdrawal Rate:</b> Percentage of portfolio withdrawn annually without depleting capital over 30 years (4% rule)</div>
    </div>
    ${footer(2)}
  </div>`;
}

// ─── Page 3: Financial Statement ──────────────────────────────────────────────
function page3(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, incomeExpense, balanceSheet, qoqChanges } = data;
  const { monthlyIncome, monthlyExpense, monthlySurplus, savingsRate } = incomeExpense;
  const nwPos = parseFloat(String(qoqChanges.netWorth)) >= 0;

  const expenseRows = incomeExpense.expenseBreakdown.map(e =>
    `<div class="metric-row"><span class="metric-label">${e.category}</span><span class="metric-value">${rs(fmt_in(e.amount), "#1F2937", "8px")}</span></div>`
  ).join("");

  const assetRows = balanceSheet.assets.map(a =>
    `<div class="metric-row"><span class="metric-label">${a.name}</span><span class="metric-value">${rs(fmt_cr(a.value), "#1F2937", "8px")}</span></div>`
  ).join("");

  const liabRows = balanceSheet.liabilities.length === 0
    ? `<div class="metric-label">No outstanding loans</div>`
    : balanceSheet.liabilities.map(l => `
            <div style="margin-bottom:4px">
              <div class="metric-row"><span class="metric-label">${l.name}</span><span class="metric-value">${rs(fmt_cr(l.outstanding), "#1F2937", "8px")}</span></div>
              <div style="font-size:7px;color:${GRAY}">EMI: ${rs(fmt_in(l.emi), GRAY, "7px")}/mo &bull; ${l.tenure_months} months left</div>
            </div>`).join("");

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}
    <div class="page-body page-body-with-footnotes">
      <div class="page-title">Financial Statement</div>
      <div class="insight"><b>Executive Insight:</b> Healthy savings rate of ${pct(savingsRate)} with monthly surplus of ${rs(fmt_in(monthlySurplus))} supporting wealth growth.</div>

      <div class="section-title" style="text-align:center">Profit / Loss (Monthly)</div>
      <div class="row2" style="flex:1;min-height:0">
        <div class="ins-box" style="background:#F0FDF4;border:1.5px solid ${GREEN}">
          <div class="card-label" style="font-size:9px">Income&sup1;&sup3;</div>
          <div style="font-size:36px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GREEN}">${rs(fmt_in(monthlyIncome), GREEN, "32px")}</div>
          <div class="divider"></div>
          <div class="metric-row"><span class="metric-label" style="font-size:9px">Monthly Income</span><span class="metric-value">${rs(fmt_in(monthlyIncome), "#1F2937", "9px")}</span></div>
          <div class="divider"></div>
          <div class="metric-row" style="font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif"><span style="font-size:9px">Total Income</span><span style="font-size:9px">${rs(fmt_in(monthlyIncome), "#1F2937", "9px")}</span></div>
        </div>
        <div class="ins-box" style="background:#FEF2F2;border:1.5px solid ${RED}">
          <div class="card-label" style="font-size:9px">Expenses&sup1;&sup4;</div>
          <div style="font-size:36px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${RED}">${rs(fmt_in(monthlyExpense), RED, "32px")}</div>
          <div class="divider"></div>
          ${expenseRows}
          <div class="divider"></div>
          <div class="metric-row" style="font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif"><span style="font-size:9px">Total Expenses</span><span style="font-size:9px">${rs(fmt_in(monthlyExpense), "#1F2937", "9px")}</span></div>
        </div>
      </div>

      <div style="padding:0 40px;margin-bottom:10px;flex-shrink:0">
        <div class="card" style="display:flex;justify-content:space-around;border:2px solid ${GREEN}">
          <div style="text-align:center"><div class="metric-label">Surplus&sup1;&sup5;</div><div style="font-size:32px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GREEN}">${rs(fmt_in(monthlySurplus), GREEN, "28px")}</div></div>
          <div style="text-align:center"><div class="metric-label">Savings Rate&sup1;&sup6;</div><div style="font-size:32px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GREEN}">${pct(savingsRate)}</div></div>
          <div style="text-align:center"><div class="metric-label">Annual Surplus</div><div style="font-size:20px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:#1F2937">${rs(fmt_cr(incomeExpense.annualSurplus), "#1F2937", "16px")}</div></div>
        </div>
      </div>

      <div class="section-title" style="text-align:center">Balance Sheet (As on ${currentQuarter})</div>
      <div class="row2" style="flex:1;min-height:0">
        <div class="ins-box" style="background:#EFF6FF;border:1.5px solid ${NAVY}">
          <div class="card-label" style="font-size:9px">Assets&sup1;&sup7;</div>
          <div style="font-size:36px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${rs(fmt_cr(balanceSheet.totalAssets), NAVY, "32px")}</div>
          <div class="divider"></div>
          ${assetRows}
          <div class="divider"></div>
          <div class="metric-row" style="font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif"><span style="font-size:9px">Total Assets</span><span style="font-size:9px">${rs(fmt_cr(balanceSheet.totalAssets), "#1F2937", "9px")}</span></div>
        </div>
        <div class="ins-box" style="background:#FFF7ED;border:1.5px solid #F97316">
          <div class="card-label" style="font-size:9px">Liabilities&sup1;&sup8;</div>
          <div style="font-size:36px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:#F97316">${rs(fmt_cr(balanceSheet.totalLiabilities), "#F97316", "32px")}</div>
          <div class="divider"></div>
          ${liabRows}
          <div class="divider"></div>
          <div class="metric-row" style="font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif"><span style="font-size:9px">Total Liabilities</span><span style="font-size:9px">${rs(fmt_cr(balanceSheet.totalLiabilities), "#1F2937", "9px")}</span></div>
        </div>
      </div>

      <div style="padding:0 40px;flex-shrink:0">
        <div class="card" style="display:flex;justify-content:space-around;border:2px solid ${GOLD}">
          <div style="text-align:center"><div class="metric-label">Net Worth&sup1;&sup9;</div><div style="font-size:32px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GOLD}">${rs(fmt_cr(balanceSheet.netWorth), GOLD, "28px")}</div></div>
          <div style="text-align:center"><div class="metric-label">QoQ Change</div><div style="font-size:28px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${nwPos ? GREEN : RED}">${nwPos ? "+" : ""}${balanceSheet.qoqNwPct}%</div></div>
          <div style="text-align:center"><div class="metric-label">Previous Quarter</div><div style="font-size:20px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:#1F2937">${rs(fmt_cr(balanceSheet.netWorthPrevQ), "#1F2937", "16px")}</div></div>
        </div>
      </div>
    </div>

    <div class="footnotes-block">
      <div class="fn"><b>13. Income:</b> Total monthly income from all sources</div>
      <div class="fn"><b>14. Expenses:</b> Housing + Food + Transport + Others = ${rs(fmt_in(monthlyExpense), "#111", "7px")}/month</div>
      <div class="fn"><b>15. Surplus:</b> Income &minus; Expenses = ${rs(fmt_in(monthlyIncome), "#111", "7px")} &minus; ${rs(fmt_in(monthlyExpense), "#111", "7px")} = ${rs(fmt_in(monthlySurplus), "#111", "7px")}/month</div>
      <div class="fn"><b>16. Savings Rate:</b> (Surplus / Income) &times; 100 = ${pct(savingsRate)}</div>
      <div class="fn"><b>17. Assets:</b> All resources owned with economic value = ${rs(fmt_cr(balanceSheet.totalAssets), "#111", "7px")}</div>
      <div class="fn"><b>18. Liabilities:</b> All financial obligations = ${rs(fmt_cr(balanceSheet.totalLiabilities), "#111", "7px")}</div>
      <div class="fn"><b>19. Net Worth:</b> Total Assets &minus; Total Liabilities = ${rs(fmt_cr(balanceSheet.netWorth), "#111", "7px")}</div>
    </div>
    ${footer(3)}
  </div>`;
}

// ─── Page 4: Net Worth ────────────────────────────────────────────────────────
function page4(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, balanceSheet, netWorthPage } = data;
  const nwPos = parseFloat(String(balanceSheet.qoqNwPct)) >= 0;

  const trendQoQ = (trend: { q: string; value: number }[]) => {
    if (trend.length < 2) return { pct: "0.0", abs: 0, last: 0, prev: 0, lastQ: "", prevQ: "" };
    const prev = trend[trend.length - 2]!;
    const last = trend[trend.length - 1]!;
    const p = prev.value ? (((last.value - prev.value) / prev.value) * 100).toFixed(1) : "0.0";
    return { pct: p, abs: last.value - prev.value, last: last.value, prev: prev.value, lastQ: last.q, prevQ: prev.q };
  };

  const cats = [
    { label: "Equity (MF + Direct)", trend: netWorthPage.equityTrend, color: NAVY },
    { label: "Debt (FD + PPF/EPF)", trend: netWorthPage.debtTrend, color: GOLD },
    { label: "Real Estate", trend: netWorthPage.realEstateTrend, color: GRAY },
    { label: "Gold & Cash", trend: netWorthPage.goldCashTrend, color: "#D1D5DB" },
  ] as const;

  const catCards = cats.map(cat => {
    const q = trendQoQ([...cat.trend]);
    const td = [...cat.trend].map(p => ({ label: p.q, value: p.value }));
    return `
        <div class="card" style="flex:1;min-height:0">
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${cat.label}</span>
            <span style="font-size:9px;color:${parseFloat(q.pct) >= 0 ? GREEN : RED}">${parseFloat(q.pct) >= 0 ? "+" : ""}${q.pct}% QoQ</span>
          </div>
          ${sparkline(td, cat.color, 870, 80, true)}
          <div style="font-size:7px;color:${GRAY};margin-top:2px">${q.prevQ}: ${rs(fmt_cr(q.prev * 100_000), GRAY, "7px")} &rarr; ${q.lastQ}: ${rs(fmt_cr(q.last * 100_000), GRAY, "7px")} (Absolute: ${q.abs >= 0 ? "+" : "&minus;"}${Math.abs(q.abs).toFixed(1)} L)</div>
        </div>`;
  }).join("");

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}
    <div class="page-body page-body-with-footnotes">
      <div class="page-title">Net Worth</div>
      <div class="insight"><b>Executive Insight:</b> Diversified portfolio across asset classes at age ${clientData.age}.</div>

      <div class="row2">
        <div class="card" style="text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px;gap:8px">
          <div class="card-label">Current Net Worth&sup2;&sup0;</div>
          <div style="font-size:40px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${rs(fmt_cr(balanceSheet.netWorth), NAVY, "34px")}</div>
          <span class="${nwPos ? "badge-pos" : "badge-neg"}">${nwPos ? "+" : ""}${Math.abs(parseFloat(String(balanceSheet.qoqNwPct)))}%</span>
          <div class="card-sub">vs ${data.previousQuarter}</div>
          <div class="card-sub">Previous Quarter: ${rs(fmt_cr(balanceSheet.netWorthPrevQ), GRAY, "8px")}</div>
        </div>
        <div class="card" style="text-align:center">
          <div class="card-label" style="margin-bottom:6px">Net Worth Distribution&sup2;&sup1;</div>
          ${pieChart(netWorthPage.pieData, 160)}
        </div>
      </div>

      <div class="section-title">Quarterly Performance Trends (Last 3 Quarters) &mdash; *Estimated</div>
      <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">
        ${catCards}
      </div>
    </div>

    <div class="footnotes-block">
      <div class="fn"><b>20. Net Worth:</b> Total Assets &minus; Total Liabilities</div>
      <div class="fn"><b>21. Asset Allocation:</b> Distribution across asset classes. Trend lines estimated via deterministic backward simulation.</div>
    </div>
    ${footer(4)}
  </div>`;
}

// ─── Page 5: Goals Planning ───────────────────────────────────────────────────
function page5(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, goals, goalsTotal, yearlyGoalRequirements } = data;

  const goalRows = goals.map((g: VelvetReportGoal) => `
      <tr>
        <td>Goal ${g.no}</td>
        <td class="bold">${g.name}</td>
        <td class="text-right">${g.targetYear}</td>
        <td class="text-right">${g.timeInHand}</td>
        <td class="text-right">${rs(fmt_in(g.monthlySavingsReq), "#374151", "8px")}</td>
        <td class="text-right">${rs(fmt_cr(g.yearlySavingsReq), "#374151", "8px")}</td>
        <td class="text-right">${rs(fmt_cr(g.futureValue), "#374151", "8px")}</td>
      </tr>`).join("");

  const yrRows = yearlyGoalRequirements.map((r: YearlyGoalRequirement) => `
      <tr>
        <td>${r.year}</td>
        <td class="text-right">${rs(fmt_in(r.monthly_required), "#374151", "8px")}</td>
        <td class="text-right">${rs(fmt_in(r.yearly_required), "#374151", "8px")}</td>
      </tr>`).join("");

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}
    <div class="page-body page-body-with-footnotes">
      <div class="page-title">Goals Planning</div>
      <div class="insight"><b>Executive Insight:</b> Total goal funding requirement of ${rs(fmt_in(goalsTotal.monthlySavingsReq))}/month across ${goals.length} goals.</div>

      <table class="tbl" style="margin-bottom:6px">
        <thead>
          <tr>
            <th style="width:6%">No.</th>
            <th style="width:22%">Goal Name</th>
            <th class="text-right" style="width:12%">Target Year</th>
            <th class="text-right" style="width:7%">Yrs</th>
            <th class="text-right" style="width:16%">Monthly SIP&sup2;&sup2;</th>
            <th class="text-right" style="width:16%">Yearly</th>
            <th class="text-right" style="width:16%">Future Value&sup2;&sup3;</th>
          </tr>
        </thead>
        <tbody>
          ${goalRows}
          <tr style="background:#FEF9C3">
            <td></td>
            <td class="bold">Total Savings Required</td>
            <td></td><td></td>
            <td class="text-right bold">${rs(fmt_in(goalsTotal.monthlySavingsReq), "#374151", "8px")}</td>
            <td class="text-right bold">${rs(fmt_cr(goalsTotal.yearlySavingsReq), "#374151", "8px")}</td>
            <td class="text-right bold">${rs(fmt_cr(goalsTotal.futureValue), "#374151", "8px")}</td>
          </tr>
        </tbody>
      </table>

      <div style="display:flex;flex-direction:column;flex:1;min-height:0">
        <div class="section-title">Year-by-Year Savings Requirement</div>
        <table class="tbl" style="height:100%">
          <thead>
            <tr>
              <th style="width:20%">Year</th>
              <th class="text-right" style="width:40%">Monthly Required</th>
              <th class="text-right" style="width:40%">Yearly Required</th>
            </tr>
          </thead>
          <tbody>${yrRows}</tbody>
        </table>
      </div>
    </div>

    <div class="footnotes-block">
      <div class="fn">Assumptions: Inflation&sup2;&sup5; 6% | SIP Return 10% | FV Growth 8%</div>
      <div class="fn"><b>22. Monthly SIP:</b> PMT formula to accumulate future value at assumed returns and inflation</div>
      <div class="fn"><b>23. Future Value:</b> Today's cost &times; (1.08)^years</div>
      <div class="fn"><b>24. Year-by-Year Requirement:</b> Aggregated monthly and yearly commitment across all active goals</div>
      <div class="fn"><b>25. Inflation:</b> 6% annual cost-of-living increase applied to all goals</div>
    </div>
    ${footer(5)}
  </div>`;
}

// ─── Page 6: Insurance ────────────────────────────────────────────────────────
function page6(data: VelvetReportViewData): string {
  const { currentQuarter, clientData, insurance, summaryQuarter } = data;
  const termGap = insurance.termLife.gap > 0;
  const healthGap = insurance.health.gap > 0;
  const termTarget = Math.max(insurance.termLife.recommended, insurance.termLife.have);
  const healthTarget = Math.max(insurance.health.recommended, insurance.health.have);

  return `
  <div class="page">
    ${header(currentQuarter, clientData.name, clientData.age, clientData.city)}
    <div class="page-body">
      <div class="page-title">Insurance</div>
      <div class="insight"><b>Executive Insight:</b> ${termGap ? `Term life gap of ${rs(fmt_cr(insurance.termLife.gap))} identified. ` : "Term life adequately covered. "}${healthGap ? `Health gap of ${rs(fmt_cr(insurance.health.gap))} identified.` : `Health cover of ${rs(fmt_cr(insurance.health.have))} is adequate.`}</div>

      <div class="section-title">Term Life Insurance</div>
      <div style="margin-bottom:10px;flex-shrink:0;background:#F3F4F6;border-radius:8px;padding:12px">
        <div style="display:flex;gap:12px">
          <div style="flex:1;display:flex;justify-content:center">${barChart(insurance.termLife.have, insurance.termLife.recommended, GOLD, NAVY, "Cr")}</div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center">
            <div class="ins-box" style="background:#FFFBEB;border:1px solid ${GOLD};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">Current Coverage</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GOLD}">${rs(fmt_cr(insurance.termLife.have), GOLD, "14px")}</span>
            </div>
            <div class="ins-box" style="background:rgba(30,58,95,0.05);border:1px solid ${NAVY};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">Recommended</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${rs(fmt_cr(insurance.termLife.recommended), NAVY, "14px")}</span>
            </div>
            <div class="ins-box" style="background:${termGap ? "#FEF2F2" : "#F0FDF4"};border:1px solid ${termGap ? RED : GREEN};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">${termGap ? "Shortfall" : "Status"}</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${termGap ? RED : GREEN}">${termGap ? rs(fmt_cr(insurance.termLife.gap), RED, "14px") : "&#10003; Adequate"}</span>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;background:#EDE9E6;border-left:3px solid ${GOLD};border-radius:4px;padding:8px 10px">
          <div style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY};margin-bottom:3px">Recommendation:</div>
          <div style="font-size:8px;color:#374151;line-height:1.4">
            ${termGap
      ? `Increase term life cover to at least ${rs(fmt_cr(termTarget), NAVY, "8px")} to close the current shortfall of ${rs(fmt_cr(insurance.termLife.gap), RED, "8px")} and protect liabilities plus family expenses.`
      : `Current term cover of ${rs(fmt_cr(insurance.termLife.have), NAVY, "8px")} is aligned with the recommended requirement.`}
          </div>
        </div>
      </div>

      <div class="section-title">Health Insurance</div>
      <div style="margin-bottom:10px;flex-shrink:0;background:#F3F4F6;border-radius:8px;padding:12px">
        <div style="display:flex;gap:12px">
          <div style="flex:1;display:flex;justify-content:center">${barChart(insurance.health.have, insurance.health.recommended, GREEN, NAVY, "L")}</div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center">
            <div class="ins-box" style="background:#F0FDF4;border:1px solid ${GREEN};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">Current Coverage</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${GREEN}">${rs(fmt_cr(insurance.health.have), GREEN, "14px")}</span>
            </div>
            <div class="ins-box" style="background:rgba(30,58,95,0.05);border:1px solid ${NAVY};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">Recommended</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${rs(fmt_cr(insurance.health.recommended), NAVY, "14px")}</span>
            </div>
            <div class="ins-box" style="background:${healthGap ? "#FEF2F2" : "rgba(34,197,94,0.15)"};border:1px solid ${healthGap ? RED : GREEN};display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif">${healthGap ? "Shortfall" : "Status"}</span>
              <span style="font-size:16px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${healthGap ? RED : GREEN}">${healthGap ? rs(fmt_cr(insurance.health.gap), RED, "14px") : "&#10003; Adequate"}</span>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;background:${healthGap ? "#FEF2F2" : "#DCFCE7"};border-left:3px solid ${healthGap ? RED : GREEN};border-radius:4px;padding:8px 10px">
          <div style="font-size:9px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY};margin-bottom:3px">Status:</div>
          <div style="font-size:8px;color:#374151;line-height:1.4">
            ${healthGap
      ? `Current health insurance of ${rs(fmt_cr(insurance.health.have), GREEN, "8px")} is below recommended ${rs(fmt_cr(healthTarget), NAVY, "8px")}. Increase by ${rs(fmt_cr(insurance.health.gap), RED, "8px")}.`
      : `Current health insurance of ${rs(fmt_cr(insurance.health.have), GREEN, "8px")} is above the recommended minimum of ${rs(fmt_cr(healthTarget), NAVY, "8px")}. Coverage is adequate.`}
          </div>
        </div>
      </div>

      <div class="section-title">Additional Coverage Recommendations</div>
      <div class="card" style="margin-bottom:10px;border:1px solid ${GOLD};flex-shrink:0">
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${[
      { title: "Critical Illness Rider", desc: "50L coverage for serious illnesses (cancer, heart attack, stroke)" },
      { title: "Accidental Death Benefit", desc: "Additional 1 Cr in case of accidental death" },
      { title: "Disability Income", desc: "Monthly income replacement if unable to work due to disability" },
      { title: "Parents Health Cover", desc: "Separate 10L health insurance for parents if uncovered" },
    ].map(r => `
            <div style="width:48%;padding:6px;background:white;border:0.5px solid #E5E7EB;border-radius:4px">
              <div style="display:flex;align-items:flex-start;gap:5px">
                <span style="color:${GOLD};font-size:10px;line-height:1.2">&#9679;</span>
                <div>
                  <div style="font-size:8px;font-weight:bold;font-family:'NotoSansBold','NotoSans',sans-serif;color:${NAVY}">${r.title}</div>
                  <div style="font-size:7.5px;color:${GRAY}">${r.desc}</div>
                </div>
              </div>
            </div>`).join("")}
        </div>
      </div>

      <div class="summary-box">
        <div class="summary-title">Quarter End Summary</div>
        <div class="summary-grid">
          <div class="summary-item"><div class="sub">Net Worth</div><div class="val">${summaryQuarter.netWorth}</div></div>
          <div class="summary-item"><div class="sub">FIRE Progress</div><div class="val">${summaryQuarter.fireProgress}</div></div>
          <div class="summary-item"><div class="sub">Savings Rate</div><div class="val">${summaryQuarter.savingsRate}</div></div>
          <div class="summary-item"><div class="sub">Next Review</div><div class="val">${summaryQuarter.nextReview}</div></div>
        </div>
      </div>
    </div>

    <div class="footnotes-block footnotes-inline">
      <div class="fn">&bull; Term Life = Max(15&times; Annual Income, Total Liabilities + 10&times; Annual Expenses)</div>
      <div class="fn">&bull; Health Insurance = Max(4&times; Monthly Income, 20L minimum for family)</div>
      <div class="fn"><b>26. Term Life:</b> Pure life cover | Max(15&times; Annual Income, Total Liabilities + 10&times; Annual Expenses)</div>
      <div class="fn"><b>27. Health Insurance:</b> Medical expense coverage | Max(4&times; Monthly Income, 20L minimum)</div>
      <div class="fn"><b>28. Super Top-up:</b> Additional health coverage activating after base sum is exhausted</div>
      <div class="fn"><b>29. Critical Illness Rider:</b> Lump-sum payout on diagnosis of specified serious diseases</div>
    </div>
    ${footer(6)}
  </div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function generateFireReportHTML(data: VelvetReportViewData): string {
  const regularB64 = fontB64("NotoSans-Regular.ttf");
  const boldB64 = fontB64("NotoSans-Bold.ttf");
  const css = getCSS(regularB64, boldB64);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Velvet Wealth Health Report</title>
  <style>${css}</style>
 <script>
        // Check for the fonts specifically
        Promise.all([
            document.fonts.load('1em NotoSans'),
            document.fonts.load('1em NotoSansBold')
        ]).then(function() { 
            window.__fontsReady = true; 
        }).catch(function() {
            // Fallback so it doesn't hang forever
            window.__fontsReady = true;
        });
    </script>
</head>
<body>
  <!-- Font-warming: visibility:hidden keeps layout so Chromium processes all three font faces -->
<div style="font-family:'NotoSans'; opacity:0.01; position:absolute; top:-100px;">Load Regular</div>
    <div style="font-family:'NotoSansBold'; opacity:0.01; position:absolute; top:-100px;">Load Bold</div>
  ${page1(data)}
  ${page2(data)}
  ${page3(data)}
  ${page4(data)}
  ${page5(data)}
  ${page6(data)}
</body>
</html>`;
}