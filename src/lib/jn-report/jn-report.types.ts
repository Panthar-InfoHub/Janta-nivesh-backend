export interface JnReportHolding {
    isin?: string;
    scheme_name: string;
    amc?: string;
    category?: string;
    sub_category?: string;
    folio_number?: string;
    units?: number;
    average_nav?: number;
    current_nav?: number;
    nav_date?: string;
    invested_amount?: number;
    current_value?: number;
    unrealised_gain?: number;
    absolute_return?: number;
    xirr?: number;
    first_invested_on?: string;
    color?: string;
}

export interface JnReportAccountReturns {
    mf_investment_account?: string;
    invested_amount?: number;
    current_value?: number;
    unrealised_gain?: number;
    absolute_return?: number;
    xirr?: number;
    folio_count?: number;
    scheme_count?: number;
    as_on?: string;
}

export interface JnReportAllocationCategory {
    fund_category: string;
    current_value: number;
    invested_amount: number;
    scheme_count: number;
    color?: string;
    weight: number;
}

export interface JnReportCapitalGainsSource {
    scheme_name: string;
    term?: string;
    units?: number;
    purchase_date?: string;
    sell_date?: string;
    purchase_value?: number;
    sale_value?: number;
    gain?: number;
}

export interface JnReportCapitalGainsTerm {
    sale_value?: number;
    cost?: number;
    gain?: number;
    taxable?: number;
    tax_rate?: number;
}

export interface JnReportCapitalGains {
    financial_year?: string;
    short_term?: JnReportCapitalGainsTerm;
    long_term?: JnReportCapitalGainsTerm;
    sources: JnReportCapitalGainsSource[];
}

export interface JnReportTransaction {
    date?: string;
    type: string;
    scheme_name: string;
    isin?: string;
    folio?: string;
    amount?: number;
    units?: number;
    nav?: number;
    status?: string;
}

export interface JnReportTransactionSummary {
    transaction_type: string;
    amount?: number;
    count?: number;
    color?: string;
}

export interface JnReportSip {
    amount?: number;
    frequency?: string;
    sip_date?: string | number;
    start_date?: string;
    installments_done?: number;
    next_installment?: string;
    mandate?: string;
    mandate_status?: string;
}

export interface JnReportFundReturnBenchmark {
    period: string;
    fund: number;
    benchmark?: number;
}

export interface JnReportFundGrowthPoint {
    month: string;
    invested: number;
    value: number;
}

export interface JnReportFund extends JnReportHolding {
    benchmark?: string;
    riskometer?: string;
    expense_ratio?: number;
    sip?: JnReportSip;
    returns_vs_benchmark?: JnReportFundReturnBenchmark[];
    growth?: JnReportFundGrowthPoint[];
    transactions?: JnReportTransaction[];
    realised_gains?: JnReportCapitalGainsSource[];
}

export interface JnReportInvestor {
    name?: string;
    pan?: string;
    mf_investment_account?: string;
    arn?: string;
}

export interface JnReportMeta {
    as_of?: string;
    generated_at: string;
}

export interface JnReportData {
    meta: JnReportMeta;
    investor: JnReportInvestor;
    accountReturns?: JnReportAccountReturns;
    holdings: JnReportHolding[];
    aumSummary: JnReportAllocationCategory[];
    transactionSummary: JnReportTransactionSummary[];
    capitalGains?: JnReportCapitalGains;
    transactions: JnReportTransaction[];
    fund?: JnReportFund;
}

export interface FpRawReportResponses {
    accountReturns?: any;
    holdings?: any;
    schemeReturns?: any;
    capitalGains?: any;
    transactionSummary?: any;
    aumSummary?: any;
    transactions?: any[];
    purchasePlans?: any[];
    investorProfile?: any;
    fundScheme?: any;
}
