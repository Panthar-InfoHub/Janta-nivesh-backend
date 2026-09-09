/** Report 1 — Overall Portfolio Statement (table-driven, section-aware). */
import { BRAND, brandBar, kpi, sectionTitle, disclaimer, shell } from './jn-report.base.js';
import * as F from './jn-report.format.js';
import { JnReportData } from './jn-report.types.js';

const has = (v: any): boolean => v !== undefined && v !== null && v !== '';
const isNum = (v: any): v is number => typeof v === 'number' && isFinite(v);
const rowIf = (cond: boolean, label: string, value: any): string =>
    cond ? `<div><span class="k">${label}</span><span class="v">${value}</span></div>` : '';

const miniBar = (pctVal: number, color: string): string => `<span style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
  <span style="display:inline-block;width:46px;height:6px;background:${BRAND.line};border-radius:4px;overflow:hidden">
    <span style="display:block;height:6px;width:${Math.min(pctVal, 100).toFixed(1)}%;background:${color};border-radius:4px"></span>
  </span><span style="width:44px;text-align:right">${F.pctPlain(pctVal, 1)}</span></span>`;

export function generatePortfolioReportHTML(d: JnReportData): string {
    const a = d.accountReturns || {};
    const inv = d.investor || {};

    const meta = `<div class="meta">
    ${rowIf(has(inv.name), 'Investor', inv.name)}
    ${rowIf(has(inv.pan), 'PAN', F.maskPan(inv.pan))}
    ${rowIf(has(inv.mf_investment_account), 'MF A/c', String(inv.mf_investment_account).slice(0, 18) + '…')}
    ${rowIf(isNum(a.folio_count), 'Folios', a.folio_count)}
    ${rowIf(has(d.meta && d.meta.as_of), 'Statement as on', F.fmtDate(d.meta.as_of))}
    ${rowIf(has(d.meta && d.meta.generated_at), 'Generated', F.fmtDate(d.meta.generated_at))}
  </div>`;

    // KPIs — only tiles whose value the API returned
    const tiles: string[] = [];
    if (isNum(a.invested_amount)) {
        tiles.push(kpi('Invested', F.inrCompact(a.invested_amount), { sub: F.inr(a.invested_amount) }));
    }
    if (isNum(a.current_value)) {
        tiles.push(kpi('Current Value', F.inrCompact(a.current_value), { sub: F.inr(a.current_value), accent: true }));
    }
    if (isNum(a.unrealised_gain)) {
        tiles.push(kpi('Total Gain', F.inrCompact(a.unrealised_gain), {
            delta: isNum(a.absolute_return) ? a.absolute_return : null,
            sub: 'Unrealised'
        }));
    }
    if (isNum(a.xirr)) {
        tiles.push(kpi('XIRR', F.pctPlain(a.xirr), { sub: 'Annualised return' }));
    }
    const kpis = tiles.length ? `<div class="kpi-row">${tiles.join('')}</div>` : '';

    // Asset allocation (aggregated from returned holdings / aum_summary)
    let allocTbl = '';
    if (Array.isArray(d.aumSummary) && d.aumSummary.length) {
        const allocRows = d.aumSummary.map(c => `<tr>
      <td class="l"><span class="legend-sw" style="display:inline-block;background:${c.color || BRAND.navy};margin-right:7px;vertical-align:middle"></span>${c.fund_category}</td>
      <td>${c.scheme_count}</td>
      <td>${F.inr(c.invested_amount)}</td>
      <td>${F.inr(c.current_value)}</td>
      <td class="${F.signClass(c.current_value - c.invested_amount)}">${F.inr(c.current_value - c.invested_amount)}</td>
      <td>${miniBar(c.weight, c.color || BRAND.navy)}</td>
    </tr>`).join('');
        allocTbl = `<div class="card">
      ${sectionTitle('Asset Allocation', 'By fund category · current value')}
      <table class="tbl">
        <thead><tr><th class="l">Category</th><th>Schemes</th><th>Invested</th><th>Current</th><th>Gain</th><th style="text-align:right">Weight</th></tr></thead>
        <tbody>${allocRows}</tbody>
      </table>
    </div><div class="spacer"></div>`;
    }

    // Holdings (core)
    const H = Array.isArray(d.holdings) ? d.holdings : [];
    const rows = H.map(h => `<tr>
    <td class="l"><div class="scheme-name">${h.scheme_name}</div>
      <div class="scheme-sub">${[h.amc, h.category && (h.category + (h.sub_category ? ' — ' + h.sub_category : '')), h.folio_number && ('Folio ' + h.folio_number)].filter(Boolean).join(' · ')}</div></td>
    <td>${F.num(h.units)}</td>
    <td>${isNum(h.average_nav) ? F.num(h.average_nav, 2) : '—'}</td>
    <td>${isNum(h.current_nav) ? F.num(h.current_nav, 2) : '—'}</td>
    <td>${F.inr(h.invested_amount)}</td>
    <td>${F.inr(h.current_value)}</td>
    <td class="${F.signClass(h.unrealised_gain)}">${F.inr(h.unrealised_gain)}</td>
    <td class="${F.signClass(h.absolute_return)}">${isNum(h.absolute_return) ? F.pct(h.absolute_return, 1) : '—'}</td>
    <td>${isNum(h.xirr) ? F.pctPlain(h.xirr, 1) : '—'}</td>
  </tr>`).join('');

    const totalRow = (isNum(a.invested_amount) && isNum(a.current_value)) ? `
    <tr class="totalrow"><td class="l">Total Portfolio</td><td></td><td></td><td></td>
      <td>${F.inr(a.invested_amount)}</td><td>${F.inr(a.current_value)}</td>
      <td class="${F.signClass(a.unrealised_gain)}">${F.inr(a.unrealised_gain)}</td>
      <td class="${F.signClass(a.absolute_return)}">${isNum(a.absolute_return) ? F.pct(a.absolute_return, 1) : '—'}</td>
      <td>${isNum(a.xirr) ? F.pctPlain(a.xirr, 1) : '—'}</td></tr>` : '';

    const holdingsTbl = `<div class="card flow">
    ${sectionTitle('Holdings', `${H.length} scheme${H.length === 1 ? '' : 's'}${has(d.meta && d.meta.as_of) ? ' · NAV as on ' + F.fmtDate(d.meta.as_of) : ''}`)}
    <table class="tbl">
      <thead><tr><th class="l">Scheme</th><th>Units</th><th>Avg NAV</th><th>Cur NAV</th><th>Invested</th><th>Current</th><th>Gain</th><th>Return</th><th>XIRR</th></tr></thead>
      <tbody>${rows || '<tr><td class="l" colspan="9">No holdings returned by the API.</td></tr>'}${totalRow}</tbody>
    </table>
  </div>`;

    // Transaction summary
    let txSumCard = '';
    if (Array.isArray(d.transactionSummary) && d.transactionSummary.length) {
        const t0 = d.transactionSummary;
        const txsTotal = t0.reduce((s, t) => s + (t.amount || 0), 0);
        const txsCount = t0.reduce((s, t) => s + (t.count || 0), 0);
        txSumCard = `<div class="card">
      ${sectionTitle('Transaction Summary', 'By type')}
      <table class="tbl">
        <thead><tr><th class="l">Type</th><th>Count</th><th>Amount</th></tr></thead>
        <tbody>${t0.map(t => `<tr><td class="l">${t.transaction_type}</td><td>${isNum(t.count) ? t.count : '—'}</td><td>${F.inr(t.amount)}</td></tr>`).join('')}
          <tr class="totalrow"><td class="l">Total</td><td>${txsCount || ''}</td><td>${F.inr(txsTotal)}</td></tr>
        </tbody>
      </table></div>`;
    }

    // Capital gains summary
    let cgCard = '';
    const cg = d.capitalGains;
    if (cg && (cg.short_term || cg.long_term)) {
        const st = cg.short_term || {};
        const lt = cg.long_term || {};
        cgCard = `<div class="card">
      ${sectionTitle('Realised Capital Gains', cg.financial_year ? `FY ${cg.financial_year}` : '')}
      <table class="tbl">
        <thead><tr><th class="l">Term</th><th>Sale Value</th><th>Cost</th><th>Gain</th><th>Taxable</th></tr></thead>
        <tbody>
          <tr><td class="l">Short Term</td><td>${F.inr(st.sale_value)}</td><td>${F.inr(st.cost)}</td><td class="${F.signClass(st.gain)}">${F.inr(st.gain)}</td><td>${has(st.taxable) ? F.inr(st.taxable) : F.inr(st.gain)}</td></tr>
          <tr><td class="l">Long Term</td><td>${F.inr(lt.sale_value)}</td><td>${F.inr(lt.cost)}</td><td class="${F.signClass(lt.gain)}">${F.inr(lt.gain)}</td><td>${has(lt.taxable) ? F.inr(lt.taxable) : '—'}</td></tr>
        </tbody>
      </table></div>`;
    }

    const twoCol = (txSumCard || cgCard)
        ? `<div class="grid-2c">${txSumCard || '<div></div>'}${cgCard || '<div></div>'}</div><div class="spacer"></div>`
        : '';

    // Capital gains sources
    let srcCard = '';
    if (cg && Array.isArray(cg.sources) && cg.sources.length) {
        const srcRows = cg.sources.map(s => `<tr>
      <td class="l">${(s.scheme_name || '').replace(/ - Growth$/, '')}</td>
      <td class="l">${s.term === 'LONG_TERM' ? 'LTCG' : s.term === 'SHORT_TERM' ? 'STCG' : (s.term || '')}</td>
      <td class="l">${F.fmtDate(s.purchase_date)} → ${F.fmtDate(s.sell_date)}</td>
      <td>${F.num(s.units)}</td><td>${F.inr(s.purchase_value)}</td><td>${F.inr(s.sale_value)}</td>
      <td class="${F.signClass(s.gain)}">${F.inr(s.gain)}</td></tr>`).join('');
        srcCard = `<div class="card flow">
      ${sectionTitle('Capital Gains — Transaction Detail', cg.financial_year ? `FY ${cg.financial_year}` : '')}
      <table class="tbl">
        <thead><tr><th class="l">Scheme</th><th class="l">Term</th><th class="l">Holding period</th><th>Units</th><th>Cost</th><th>Sale</th><th>Gain</th></tr></thead>
        <tbody>${srcRows}</tbody>
      </table></div><div class="spacer"></div>`;
    }

    // Recent transactions
    let rtCard = '';
    if (Array.isArray(d.transactions) && d.transactions.length) {
        const rtRows = d.transactions.map(t => `<tr>
      <td class="l">${F.fmtDate(t.date)}</td><td class="l">${t.type}</td>
      <td class="l">${(t.scheme_name || '').replace(/ - Growth$/, '')}</td>
      <td>${F.inr(t.amount)}</td><td>${F.num(t.units)}</td><td>${isNum(t.nav) ? F.num(t.nav, 2) : '—'}</td>
      <td class="l">${t.status ? `<span class="badge ok" style="font-size:8px">${t.status}</span>` : '—'}</td></tr>`).join('');
        rtCard = `<div class="card flow">
      ${sectionTitle('Recent Transactions', `${d.transactions.length} shown`)}
      <table class="tbl">
        <thead><tr><th class="l">Date</th><th class="l">Type</th><th class="l">Scheme</th><th>Amount</th><th>Units</th><th>NAV</th><th class="l">Status</th></tr></thead>
        <tbody>${rtRows}</tbody>
      </table></div>`;
    }

    const body = `
    ${brandBar('Portfolio Statement', `Consolidated holdings &amp; returns${has(d.meta && d.meta.as_of) ? ' · as on ' + F.fmtDate(d.meta.as_of) : ''}`)}
    ${meta}
    ${kpis}
    ${allocTbl}
    ${holdingsTbl}
    <div class="spacer"></div>
    ${twoCol}
    ${srcCard}
    ${rtCard}
    ${disclaimer(inv)}
  `;

    return shell({ title: 'Janta Nivesh — Portfolio Statement', body });
}
