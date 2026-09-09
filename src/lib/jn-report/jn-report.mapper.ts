/**
 * Maps RAW FP responses → the template data shape. STRICT: only fields the API returns
 * are surfaced; nothing is fabricated. Aggregates (allocation, totals) are computed purely
 * from returned rows. Fields not present are left undefined so the template omits them.
 */
import {
    FpRawReportResponses,
    JnReportAccountReturns,
    JnReportAllocationCategory,
    JnReportCapitalGains,
    JnReportCapitalGainsSource,
    JnReportData,
    JnReportFund,
    JnReportHolding,
    JnReportInvestor,
    JnReportSip,
    JnReportTransaction,
    JnReportTransactionSummary
} from './jn-report.types.js';

const CAT_COLORS = ['#3B5BDB', '#1FA97A', '#00AEEF', '#E8A13A', '#E5527A', '#7A5AF0', '#23336E'];

const pick = (o: any, names: string[], d?: any): any => {
    if (!o) return d;
    for (const name of names) {
        if (o[name] !== undefined && o[name] !== null) return o[name];
    }
    return d;
};

const n = (v: any): number | undefined => {
    const x = Number(v);
    return isFinite(x) ? x : undefined;
};

const arr = (v: any, key?: string): any[] => {
    if (Array.isArray(v)) return v;
    if (v && key && Array.isArray(v[key])) return v[key];
    if (v && Array.isArray(v.data)) return v.data;
    return [];
};

const r2 = (x: number | undefined): number | undefined =>
    x === undefined ? undefined : Math.round(x * 100) / 100;

export function mapHolding(h: any): JnReportHolding {
    const units = n(pick(h, ['units', 'unit_balance', 'closing_units', 'balance_units', 'closing_balance']));
    const avg = n(pick(h, ['average_nav', 'avg_nav', 'purchase_nav', 'cost_nav', 'average_cost_nav']));
    const cur = n(pick(h, ['current_nav', 'nav', 'latest_nav']));
    let invested = n(pick(h, ['invested_amount', 'invested', 'cost', 'cost_value', 'purchase_value', 'amount_invested', 'purchase_cost']));
    let current = n(pick(h, ['current_value', 'market_value', 'current_amount', 'value', 'valuation']));

    if (invested === undefined && units !== undefined && avg !== undefined) {
        invested = r2(units * avg);
    }
    if (current === undefined && units !== undefined && cur !== undefined) {
        current = r2(units * cur);
    }

    const gain = n(pick(h, ['unrealised_gain', 'unrealized_gain', 'gain', 'unrealised_pnl']))
        ?? ((current !== undefined && invested !== undefined) ? r2(current - invested) : undefined);

    const absR = n(pick(h, ['absolute_return', 'absolute_returns', 'returns']))
        ?? ((gain !== undefined && invested) ? r2((gain / invested) * 100) : undefined);

    return {
        isin: pick(h, ['isin']),
        scheme_name: pick(h, ['scheme_name', 'scheme', 'fund_scheme_name', 'name'], ''),
        amc: pick(h, ['amc', 'amc_name']),
        category: pick(h, ['category', 'fund_category', 'asset_category']),
        sub_category: pick(h, ['sub_category', 'scheme_sub_category']),
        folio_number: pick(h, ['folio_number', 'folio']),
        units,
        average_nav: avg,
        current_nav: cur,
        nav_date: pick(h, ['nav_date', 'as_on', 'as_of']),
        invested_amount: invested,
        current_value: current,
        unrealised_gain: gain,
        absolute_return: absR,
        xirr: n(pick(h, ['xirr', 'annualised_return', 'annualized_return'])),
        first_invested_on: pick(h, ['first_invested_on', 'first_investment_date', 'first_purchase_date']),
    };
}

export function mapAccount(a: any, holdings: JnReportHolding[]): JnReportAccountReturns {
    if (a) {
        return {
            mf_investment_account: pick(a, ['mf_investment_account', 'mfia']),
            invested_amount: n(pick(a, ['invested_amount', 'invested', 'cost'])),
            current_value: n(pick(a, ['current_value', 'market_value', 'value'])),
            unrealised_gain: n(pick(a, ['unrealised_gain', 'gain'])),
            absolute_return: n(pick(a, ['absolute_return', 'absolute_returns'])),
            xirr: n(pick(a, ['xirr', 'annualised_return'])),
            folio_count: n(pick(a, ['folio_count'])) ?? holdings.length,
            scheme_count: n(pick(a, ['scheme_count'])) ?? new Set(holdings.map(h => h.isin)).size,
            as_on: pick(a, ['as_on', 'as_of']),
        };
    }

    // fallback: aggregate purely from returned holdings
    const inv = holdings.reduce((s, h) => s + (h.invested_amount || 0), 0);
    const cur = holdings.reduce((s, h) => s + (h.current_value || 0), 0);
    if (!holdings.length) return {};

    return {
        invested_amount: r2(inv),
        current_value: r2(cur),
        unrealised_gain: r2(cur - inv),
        absolute_return: inv ? r2(((cur - inv) / inv) * 100) : undefined,
        folio_count: holdings.length,
        scheme_count: new Set(holdings.map(h => h.isin)).size
    };
}

export function mapAllocation(aum: any, holdings: JnReportHolding[], totalCurrent: number): JnReportAllocationCategory[] {
    let cats: JnReportAllocationCategory[];
    if (aum && arr(aum, 'aum_summary').length) {
        cats = arr(aum, 'aum_summary').map((c: any) => ({
            fund_category: pick(c, ['fund_category', 'category']),
            current_value: n(pick(c, ['current_value', 'aum', 'market_value', 'value'])) || 0,
            invested_amount: n(pick(c, ['invested_amount', 'invested', 'cost'])) || 0,
            scheme_count: n(pick(c, ['scheme_count', 'count'])) || 0,
            weight: 0,
        }));
    } else {
        // aggregate from returned holdings
        const m: Record<string, JnReportAllocationCategory> = {};
        for (const h of holdings) {
            const k = h.category || 'Uncategorised';
            if (!m[k]) {
                m[k] = { fund_category: k, current_value: 0, invested_amount: 0, scheme_count: 0, weight: 0 };
            }
            m[k].current_value = (r2(m[k].current_value + (h.current_value || 0))) || 0;
            m[k].invested_amount = (r2(m[k].invested_amount + (h.invested_amount || 0))) || 0;
            m[k].scheme_count++;
        }
        cats = Object.values(m);
    }

    cats.sort((a, b) => b.current_value - a.current_value);
    cats.forEach((c, i) => {
        c.color = CAT_COLORS[i % CAT_COLORS.length];
        c.weight = totalCurrent ? (r2((c.current_value / totalCurrent) * 100) || 0) : 0;
    });

    return cats;
}

export function mapCapitalGains(cg: any): JnReportCapitalGains | undefined {
    if (!cg) return undefined;
    const term = (t: any) => t ? {
        sale_value: n(pick(t, ['sale_value', 'redemption_value'])),
        cost: n(pick(t, ['cost', 'purchase_value'])),
        gain: n(pick(t, ['gain', 'capital_gain'])),
        taxable: n(pick(t, ['taxable', 'taxable_gain'])),
    } : undefined;

    const sources: JnReportCapitalGainsSource[] = arr(cg, 'sources').map((s: any) => ({
        scheme_name: pick(s, ['scheme_name', 'scheme', 'name'], ''),
        term: pick(s, ['term', 'gain_type']),
        units: n(pick(s, ['units'])),
        purchase_date: pick(s, ['purchase_date', 'buy_date']),
        sell_date: pick(s, ['sell_date', 'redemption_date']),
        purchase_value: n(pick(s, ['purchase_value', 'cost'])),
        sale_value: n(pick(s, ['sale_value', 'redemption_value'])),
        gain: n(pick(s, ['gain', 'capital_gain'])),
    }));

    return {
        financial_year: pick(cg, ['financial_year', 'fy']),
        short_term: term(cg.short_term),
        long_term: term(cg.long_term),
        sources
    };
}

export function mapTransaction(t: any): JnReportTransaction {
    return {
        date: pick(t, ['date', 'transaction_date', 'created_at', 'txn_date']),
        type: pick(t, ['type', 'transaction_type', 'txn_type'], ''),
        scheme_name: pick(t, ['scheme_name', 'scheme', 'fund_scheme_name'], ''),
        isin: pick(t, ['isin']),
        folio: pick(t, ['folio_number', 'folio']),
        amount: n(pick(t, ['amount', 'transaction_amount'])),
        units: n(pick(t, ['units'])),
        nav: n(pick(t, ['nav', 'price'])),
        status: pick(t, ['status', 'state']),
    };
}

export function mapSip(plans: any, isin?: string): JnReportSip | undefined {
    const pList = arr(plans, 'mf_purchase_plans');
    const p = (isin ? pList.find((x: any) => pick(x, ['isin']) === isin) : null) || pList[0];
    if (!p) return undefined;

    const dates = pick(p, ['dates']) || [];
    return {
        amount: n(pick(p, ['installment_amount', 'amount'])),
        frequency: pick(p, ['frequency']),
        sip_date: dates[0] || pick(p, ['sip_date', 'day_of_month']),
        start_date: pick(p, ['start_date']),
        installments_done: n(pick(p, ['completed_installments', 'installments_done'])),
        next_installment: pick(p, ['next_installment_date', 'next_installment']),
        mandate: pick(p, ['payment_method', 'mandate']),
        mandate_status: pick(p, ['state', 'status']),
    };
}

export interface MapAllOptions {
    mfia?: string;
    fundIsin?: string;
    investor?: JnReportInvestor;
}

export function mapAll(raw: FpRawReportResponses, opts: MapAllOptions = {}): JnReportData {
    const holdings = arr(raw.holdings, 'holdings').map(mapHolding).filter(h => h.scheme_name);
    const account = mapAccount(raw.accountReturns, holdings);
    const totalCurrent = account.current_value ?? holdings.reduce((s, h) => s + (h.current_value || 0), 0);
    const aumSummary = mapAllocation(raw.aumSummary, holdings, totalCurrent);

    // enrich holdings returns from scheme_returns if holdings lacked them
    const sr = arr(raw.schemeReturns, 'scheme_returns');
    if (sr.length) {
        for (const h of holdings) {
            const s = sr.find((x: any) => pick(x, ['isin']) === h.isin);
            if (s) {
                if (h.xirr === undefined) h.xirr = n(pick(s, ['xirr', 'annualised_return']));
                if (h.absolute_return === undefined) h.absolute_return = n(pick(s, ['absolute_return', 'returns']));
            }
        }
    }

    const transactions = arr(raw.transactions, 'transactions').map(mapTransaction);
    const transactionSummary: JnReportTransactionSummary[] = arr(raw.transactionSummary, 'transaction_summary').map((t: any, i: number) => ({
        transaction_type: pick(t, ['transaction_type', 'type'], ''),
        amount: n(pick(t, ['amount', 'total_amount'])),
        count: n(pick(t, ['count', 'transaction_count'])),
        color: CAT_COLORS[i % CAT_COLORS.length],
    }));

    const capitalGains = mapCapitalGains(raw.capitalGains);

    // investor identity comes from caller's system (or investor_profile if fetched)
    const prof = raw.investorProfile || {};
    const investor: JnReportInvestor = {
        name: opts.investor?.name ?? pick(prof, ['name', 'full_name']),
        pan: opts.investor?.pan ?? pick(prof, ['pan']),
        mf_investment_account: opts.mfia || account.mf_investment_account,
        arn: opts.investor?.arn,
    };

    // Fund report: pick requested ISIN (or largest holding by current value)
    const fundIsin = opts.fundIsin || (holdings.slice().sort((a, b) => (b.current_value || 0) - (a.current_value || 0))[0]?.isin);
    const fh = holdings.find(h => h.isin === fundIsin) || holdings[0];
    let fund: JnReportFund | undefined = undefined;

    if (fh) {
        const fs = raw.fundScheme || {};
        fund = {
            ...fh,
            category: fh.category ?? pick(fs, ['fund_category']),
            sub_category: fh.sub_category ?? pick(fs, ['sub_category']),
            sip: mapSip(raw.purchasePlans, fh.isin),
            transactions: transactions.filter(t => (t.isin && t.isin === fh.isin) || t.scheme_name === fh.scheme_name),
            realised_gains: (capitalGains?.sources || []).filter(s => s.scheme_name === fh.scheme_name),
        };
    }

    const as_of = account.as_on || holdings.map(h => h.nav_date).find(Boolean);

    return {
        meta: { as_of, generated_at: new Date().toISOString() },
        investor,
        accountReturns: account,
        holdings,
        aumSummary,
        transactionSummary,
        capitalGains,
        transactions,
        fund,
    };
}
