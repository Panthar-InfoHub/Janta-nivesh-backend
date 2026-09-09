/** Report 2 — Fund Holding Report (single scheme, table-driven, section-aware). */
import { BRAND, brandBar, kpi, sectionTitle, disclaimer, shell } from './jn-report.base.js';
import * as F from './jn-report.format.js';
import { JnReportData } from './jn-report.types.js';

const has = (v: any): boolean => v !== undefined && v !== null && v !== '';
const isNum = (v: any): v is number => typeof v === 'number' && isFinite(v);
const kvRow = (cond: boolean, label: string, value: any): string =>
    cond ? `<span class="k">${label}</span><span class="v">${value}</span>` : '';

export function generateFundReportHTML(d: JnReportData): string {
    const f = d.fund || ({} as any);
    const inv = d.investor || {};

    const meta = `<div class="meta">
    ${has(inv.name) ? `<div><span class="k">Investor</span><span class="v">${inv.name}</span></div>` : ''}
    ${has(f.folio_number) ? `<div><span class="k">Folio</span><span class="v">${f.folio_number}</span></div>` : ''}
    ${has(f.isin) ? `<div><span class="k">ISIN</span><span class="v">${f.isin}</span></div>` : ''}
    ${has(f.category) ? `<div><span class="k">Category</span><span class="v">${f.category}${f.sub_category ? ' — ' + f.sub_category : ''}</span></div>` : ''}
    ${has(d.meta && d.meta.as_of) ? `<div><span class="k">As on</span><span class="v">${F.fmtDate(d.meta.as_of)}</span></div>` : ''}
  </div>`;

    const badges = [
        has(f.amc) ? `<span class="badge">${f.amc}</span>` : '',
        has(f.riskometer) ? `<span class="badge risk">Riskometer: ${f.riskometer}</span>` : '',
        (f.sip && has(f.sip.mandate_status)) ? `<span class="badge ok">SIP ${f.sip.mandate_status}</span>` : '',
        has(f.benchmark) ? `<span class="badge">Benchmark: ${f.benchmark}</span>` : '',
        isNum(f.expense_ratio) ? `<span class="badge">Expense ratio ${F.pctPlain(f.expense_ratio, 2)}</span>` : '',
    ].filter(Boolean).join(' ');
    const tags = badges ? `<div style="margin:-2px 0 14px;display:flex;gap:8px;flex-wrap:wrap">${badges}</div>` : '';

    const tiles: string[] = [];
    if (isNum(f.units)) {
        tiles.push(kpi('Units Held', F.num(f.units), {
            sub: isNum(f.current_nav)
                ? 'NAV ' + F.num(f.current_nav, 2) + (has(f.nav_date) ? ' · ' + F.fmtDate(f.nav_date) : '')
                : ''
        }));
    }
    if (isNum(f.invested_amount)) {
        tiles.push(kpi('Invested', F.inrCompact(f.invested_amount), {
            sub: isNum(f.average_nav) ? 'Avg cost ' + F.num(f.average_nav, 2) : ''
        }));
    }
    if (isNum(f.current_value)) {
        tiles.push(kpi('Current Value', F.inrCompact(f.current_value), {
            accent: true,
            sub: F.inr(f.current_value)
        }));
    }
    if (isNum(f.unrealised_gain)) {
        tiles.push(kpi('Gain', F.inrCompact(f.unrealised_gain), {
            delta: isNum(f.absolute_return) ? f.absolute_return : null,
            sub: isNum(f.xirr) ? 'XIRR ' + F.pctPlain(f.xirr, 1) : ''
        }));
    }
    const kpis = tiles.length ? `<div class="kpi-row">${tiles.join('')}</div>` : '';

    // Fund & holding details
    const factRows = [
        kvRow(has(f.scheme_name), 'Scheme', f.scheme_name),
        kvRow(has(f.amc), 'AMC', f.amc),
        kvRow(has(f.category), 'Category', `${f.category || ''}${f.sub_category ? ' — ' + f.sub_category : ''}`),
        kvRow(has(f.benchmark), 'Benchmark', f.benchmark),
        kvRow(has(f.riskometer), 'Riskometer', f.riskometer),
        kvRow(isNum(f.expense_ratio), 'Expense ratio', F.pctPlain(f.expense_ratio, 2)),
        kvRow(isNum(f.units), 'Units held', F.num(f.units)),
        kvRow(isNum(f.average_nav), 'Avg cost NAV', '₹' + F.num(f.average_nav, 2)),
        kvRow(isNum(f.current_nav), 'Current NAV', '₹' + F.num(f.current_nav, 2) + (has(f.nav_date) ? ' (' + F.fmtDate(f.nav_date) + ')' : '')),
        kvRow(has(f.first_invested_on), 'First invested', F.fmtDate(f.first_invested_on)),
    ].filter(Boolean).join('');
    const factsCard = factRows ? `<div class="card">${sectionTitle('Fund & Holding Details')}<div class="kv">${factRows}</div></div>` : '';

    // Active SIP (only if API returns a plan)
    let sipCard = '';
    if (f.sip) {
        const s = f.sip;
        const sipRows = [
            kvRow(isNum(s.amount), 'Installment', F.inr(s.amount) + (s.frequency ? ' / ' + s.frequency : '')),
            kvRow(has(s.sip_date), 'SIP date', s.sip_date + ' of every month'),
            kvRow(has(s.start_date), 'Started', F.fmtDate(s.start_date)),
            kvRow(isNum(s.installments_done), 'Installments paid', s.installments_done),
            kvRow(has(s.next_installment), 'Next installment', F.fmtDate(s.next_installment)),
            kvRow(has(s.mandate), 'Payment mode', s.mandate),
            kvRow(has(s.mandate_status), 'Mandate status', s.mandate_status),
        ].filter(Boolean).join('');
        if (sipRows) sipCard = `<div class="card">${sectionTitle('Active SIP')}<div class="kv">${sipRows}</div></div>`;
    }

    // Returns vs benchmark (only if API provides it)
    let rvbCard = '';
    if (Array.isArray(f.returns_vs_benchmark) && f.returns_vs_benchmark.length) {
        const withBench = f.returns_vs_benchmark.some((r: any) => isNum(r.benchmark));
        const rows = f.returns_vs_benchmark.map((r: any) => `<tr>
      <td class="l">${r.period}</td><td>${isNum(r.fund) ? F.pctPlain(r.fund, 1) : '—'}</td>
      ${withBench ? `<td>${isNum(r.benchmark) ? F.pctPlain(r.benchmark, 1) : '—'}</td><td class="${F.signClass(r.fund - r.benchmark)}">${isNum(r.fund) && isNum(r.benchmark) ? F.pct(r.fund - r.benchmark, 1) : '—'}</td>` : ''}
    </tr>`).join('');
        rvbCard = `<div class="card">${sectionTitle('Returns', withBench && f.benchmark ? 'vs ' + f.benchmark : 'Annualised')}
      <table class="tbl"><thead><tr><th class="l">Period</th><th>Fund</th>${withBench ? '<th>Benchmark</th><th>Alpha</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    }

    // Valuation history (only if growth series available)
    let valCard = '';
    if (Array.isArray(f.growth) && f.growth.length) {
        const q = f.growth.filter((_: any, i: number) => i % 3 === 0 || i === f.growth!.length - 1);
        const valRows = q.map((m: any) => {
            const gain = m.value - m.invested;
            const ret = (gain / m.invested) * 100;
            const [yr, mo] = m.month.split('-');
            const lbl = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
            return `<tr><td class="l">${lbl}</td><td>${F.inr(m.invested)}</td><td>${F.inr(m.value)}</td>
        <td class="${F.signClass(gain)}">${F.inr(gain)}</td><td class="${F.signClass(ret)}">${F.pct(ret, 1)}</td></tr>`;
        }).join('');
        valCard = `<div class="card">${sectionTitle('Valuation History', 'Quarter-end')}
      <table class="tbl"><thead><tr><th class="l">As on</th><th>Invested</th><th>Market Value</th><th>Gain</th><th>Return</th></tr></thead>
      <tbody>${valRows}</tbody></table></div>`;
    }

    // Transactions (this scheme)
    let txCard = '';
    if (Array.isArray(f.transactions) && f.transactions.length) {
        const txRows = f.transactions.map((t: any) => `<tr>
      <td class="l">${F.fmtDate(t.date)}</td><td class="l">${t.type}</td><td>${F.inr(t.amount)}</td>
      <td>${F.num(t.units)}</td><td>${isNum(t.nav) ? F.num(t.nav, 2) : '—'}</td>
      <td class="l">${t.status ? `<span class="badge ok" style="font-size:8px">${t.status}</span>` : '—'}</td></tr>`).join('');
        txCard = `<div class="card flow">${sectionTitle('Transaction History', 'This scheme')}
      <table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Type</th><th>Amount</th><th>Units</th><th>NAV</th><th class="l">Status</th></tr></thead>
      <tbody>${txRows}</tbody></table></div>`;
    }

    // Realised gains (this scheme)
    let rgCard = '';
    if (Array.isArray(f.realised_gains) && f.realised_gains.length) {
        const rgRows = f.realised_gains.map((g: any) => `<tr>
      <td class="l">${g.term === 'LONG_TERM' ? 'Long Term' : g.term === 'SHORT_TERM' ? 'Short Term' : (g.term || '')}</td>
      <td class="l">${F.fmtDate(g.purchase_date)} → ${F.fmtDate(g.sell_date)}</td>
      <td>${F.num(g.units)}</td><td>${F.inr(g.purchase_value)}</td><td>${F.inr(g.sale_value)}</td>
      <td class="${F.signClass(g.gain)}">${F.inr(g.gain)}</td></tr>`).join('');
        rgCard = `<div class="card flow">${sectionTitle('Realised Gains', 'This scheme')}
      <table class="tbl"><thead><tr><th class="l">Term</th><th class="l">Holding period</th><th>Units</th><th>Cost</th><th>Sale</th><th>Gain</th></tr></thead>
      <tbody>${rgRows}</tbody></table></div>`;
    }

    // Assemble — pair cards two-up where both exist
    const pair = (aCard: string, bCard: string): string =>
        (aCard || bCard) ? `<div class="grid-2c">${aCard || '<div></div>'}${bCard || '<div></div>'}</div><div class="spacer"></div>` : '';

    const body = `
    ${brandBar('Fund Holding Report', f.scheme_name || 'Scheme')}
    ${meta}
    ${tags}
    ${kpis}
    ${pair(factsCard, sipCard)}
    ${pair(rvbCard, valCard)}
    ${txCard}
    ${txCard && rgCard ? '<div class="spacer"></div>' : ''}
    ${rgCard}
    ${disclaimer(inv)}
  `;

    return shell({ title: 'Janta Nivesh — Fund Holding Report', body });
}
