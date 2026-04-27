import React from 'react';
import { LineChart, Line, BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, Shield } from 'lucide-react';
import type { VelvetReportViewData } from '../lib/fire-report.transformer.js';

interface Props {
  data: VelvetReportViewData;
}

const fmt_cr = (v: number) =>
  v >= 10_000_000 ? `₹${(v / 10_000_000).toFixed(2)} Cr` : `₹${(v / 100_000).toFixed(1)} L`;

const fmt_in = (v: number) =>
  v >= 100_000 ? `₹${(v / 100_000).toFixed(2)} L` : `₹${v.toLocaleString('en-IN')}`;

const VelvetWealthHealthReport = ({ data }: Props) => {
  const {
    currentQuarter,
    previousQuarter,
    clientData,
    snapshot,
    incomeExpense,
    balanceSheet,
    netWorthPage,
    goals,
    goalsTotal,
    yearlyGoalRequirements,
    insurance,
    thirtyYearProjection,
    qoqChanges,
    summaryQuarter,
  } = data;

  // Design System
  const colors = {
    navy: '#1e3a5f',
    gold: '#d4a574',
    green: '#22c55e',
    lightGreen: 'rgba(34, 197, 94, 0.08)',
    red: '#ef4444',
    lightRed: 'rgba(239, 68, 68, 0.08)',
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      500: '#6b7280',
      700: '#374151',
      800: '#1f2937',
    },
  };

  const Badge = ({ value, positive }: { value: string; positive: boolean }) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${positive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}
    >
      {positive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
      {value}%
    </span>
  );

  const PageWrapper = ({
    children,
    pageNumber,
    title,
  }: {
    children: React.ReactNode;
    pageNumber: number;
    title: string;
  }) => (
    <div
      style={{
        width: '210mm',
        minHeight: '297mm',
        margin: '0 auto',
        padding: '16mm',
        backgroundColor: 'white',
        position: 'relative',
        pageBreakAfter: pageNumber < 6 ? 'always' : 'auto',
      }}
    >
      <div
        className="flex items-center justify-between mb-6 pb-3"
        style={{ borderBottom: `2px solid ${colors.gold}` }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: '36px', height: '36px', background: colors.navy, borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 'bold', fontSize: '16px',
            }}
          >VI</div>
          <div>
            <h1 className="text-base font-bold" style={{ color: colors.navy }}>Velvet Investing</h1>
            <p className="text-xs" style={{ color: colors.gray[500] }}>Wealth Health Report • {currentQuarter}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium" style={{ color: colors.navy }}>{clientData.name}</p>
          <p className="text-xs" style={{ color: colors.gray[500] }}>Age {clientData.age} • {clientData.city}</p>
        </div>
      </div>
      <h2 className="text-lg font-semibold mb-4" style={{ color: colors.navy }}>{title}</h2>
      {children}
      <div className="absolute bottom-6 left-0 right-0 px-12">
        <div className="flex justify-between items-center pt-3" style={{ borderTop: `1px solid ${colors.gray[200]}` }}>
          <p className="text-xs" style={{ color: colors.gray[500] }}>Confidential — For Client Use Only</p>
          <p className="text-xs" style={{ color: colors.gray[500] }}>Page {pageNumber} of 6</p>
        </div>
      </div>
    </div>
  );

  const nwQoqPositive = parseFloat(qoqChanges.netWorth) >= 0;
  const fireQoqPositive = parseFloat(qoqChanges.firePercent) >= 0;

  return (
    <div style={{ fontFamily: "'Inter', 'Source Sans Pro', sans-serif", fontSize: '12px' }}>

      {/* PAGE 1 — Financial Overview */}
      <PageWrapper pageNumber={1} title="Financial Overview (Quarterly)">
        <p className="text-sm mb-6" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong> Net worth {nwQoqPositive ? 'grew' : 'declined'} {Math.abs(parseFloat(qoqChanges.netWorth))}% QoQ to {fmt_cr(snapshot.netWorth)} with steady financial asset accumulation at age {clientData.age}.
        </p>
        <div className="grid grid-cols-2 gap-6">
          {/* Current Net Worth */}
          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-sm font-medium mb-4" style={{ color: colors.gray[600] }}>Current Net Worth</p>
            <div className="flex flex-col items-center justify-center" style={{ minHeight: '180px' }}>
              <p className="text-5xl font-bold mb-4" style={{ color: colors.navy }}>{fmt_cr(snapshot.netWorth)}</p>
              <Badge value={qoqChanges.netWorth} positive={nwQoqPositive} />
              <p className="text-sm mt-4" style={{ color: colors.gray[600] }}>Previous Quarter: <span className="font-medium">{fmt_cr(snapshot.netWorthPrevQ)}</span></p>
              <p className="text-xs mt-2" style={{ color: colors.gray[500] }}>Absolute Increase: {fmt_cr(snapshot.netWorth - snapshot.netWorthPrevQ)}</p>
            </div>
          </div>
          {/* FIRE Status */}
          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-sm font-medium mb-4" style={{ color: colors.gray[600] }}>Current FIRE¹ Status</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <p className="text-xs" style={{ color: colors.gray[500] }}>FIRE Number²</p>
                <p className="text-xl font-bold" style={{ color: colors.navy }}>{fmt_cr(snapshot.fireNumber)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: colors.gray[500] }}>FIRE %³</p>
                <p className="text-xl font-bold" style={{ color: colors.gold }}>{snapshot.firePercentage.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: colors.gray[500] }}>Gap⁴</p>
                <p className="text-xl font-bold" style={{ color: colors.red }}>{fmt_cr(snapshot.fireGap)}</p>
              </div>
            </div>
            <div className="w-full h-6 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-blue-500 to-green-500" style={{ width: `${Math.min(100, snapshot.firePercentage).toFixed(1)}%` }} />
            </div>
            <div className="text-center">
              <p className="text-xs" style={{ color: colors.gray[600] }}>Annual Expenses: <span className="font-medium">{fmt_cr(snapshot.annualExpenses)}</span></p>
              <p className="text-xs mt-1" style={{ color: colors.gray[500] }}>Monthly: {fmt_in(snapshot.monthlyExpenses)}</p>
            </div>
          </div>
          {/* QoQ Net Worth Change */}
          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-sm font-medium mb-4" style={{ color: colors.gray[600] }}>QoQ Net Worth Change⁵</p>
            <div className="text-center mb-3">
              <p className="text-4xl font-bold" style={{ color: nwQoqPositive ? colors.green : colors.red }}>{nwQoqPositive ? '+' : ''}{qoqChanges.netWorth}%</p>
              <p className="text-xs mt-1" style={{ color: colors.gray[600] }}>Quarter over Quarter</p>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={snapshot.netWorthHistory} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.gray[200]} />
                <XAxis dataKey="quarter" tick={{ fontSize: 9 }} />
                <YAxis hide />
                <Tooltip formatter={(v: number) => `₹${v.toFixed(1)} L`} />
                <Line type="monotone" dataKey="value" stroke={colors.green} strokeWidth={2.5} dot={{ r: 4, fill: colors.green }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs mt-2 text-center" style={{ color: colors.gray[500] }}>{previousQuarter}: {fmt_cr(snapshot.netWorthPrevQ)} → {currentQuarter}: {fmt_cr(snapshot.netWorth)}</p>
          </div>
          {/* QoQ FIRE Score Change */}
          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-sm font-medium mb-4" style={{ color: colors.gray[600] }}>QoQ FIRE Score Change⁶</p>
            <div className="text-center mb-3">
              <p className="text-4xl font-bold" style={{ color: fireQoqPositive ? colors.gold : colors.red }}>{fireQoqPositive ? '+' : ''}{qoqChanges.firePercent}%</p>
              <p className="text-xs mt-1" style={{ color: colors.gray[600] }}>FIRE % Improvement</p>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={snapshot.fireHistory} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.gray[200]} />
                <XAxis dataKey="quarter" tick={{ fontSize: 9 }} />
                <YAxis hide />
                <Tooltip formatter={(v: number) => fmt_cr(v)} />
                <Line type="monotone" dataKey="fire" stroke={colors.gold} strokeWidth={2.5} dot={{ r: 4, fill: colors.gold }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-8 text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1"><sup>1</sup><strong>FIRE:</strong> Financial Independence, Retire Early</p>
          <p className="mb-1"><sup>2</sup><strong>FIRE Number:</strong> Annual Expenses × 30 = {fmt_cr(snapshot.annualExpenses)} × 30 = {fmt_cr(snapshot.fireNumber)}</p>
          <p className="mb-1"><sup>3</sup><strong>FIRE %:</strong> (Portfolio / FIRE Number) × 100 = {snapshot.firePercentage.toFixed(1)}%</p>
          <p className="mb-1"><sup>4</sup><strong>Gap:</strong> FIRE Number − Current Portfolio = {fmt_cr(snapshot.fireGap)}</p>
          <p className="mb-1"><sup>5</sup><strong>QoQ Net Worth Change:</strong> {qoqChanges.netWorth}%</p>
          <p className="mb-1"><sup>6</sup><strong>QoQ FIRE Score Change:</strong> {qoqChanges.firePercent} pp</p>
          <p className="mt-2">* Quarterly trend values are estimated via deterministic backward simulation</p>
        </div>
      </PageWrapper>

      {/* PAGE 2 — F.I.R.E Calculations */}
      <PageWrapper pageNumber={2} title="F.I.R.E Calculations">
        <p className="text-sm mb-4" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong> Current FIRE progress at {snapshot.firePercentage.toFixed(1)}%{snapshot.fiYear ? ` with projected financial independence by ${snapshot.fiYear} (age ${snapshot.fiAge}).` : '. Keep building your corpus consistently.'}
        </p>
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <div>
              <p className="text-xs font-medium" style={{ color: colors.gray[600] }}>Current Portfolio</p>
              <p className="text-xl font-bold" style={{ color: colors.navy }}>{fmt_cr(snapshot.fireCurrentCorpus)}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold" style={{ color: colors.gold }}>{snapshot.firePercentage.toFixed(1)}%</p>
              <p className="text-xs" style={{ color: colors.gray[600] }}>FIRE Progress</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium" style={{ color: colors.gray[600] }}>FIRE Target</p>
              <p className="text-xl font-bold" style={{ color: colors.red }}>{fmt_cr(snapshot.fireNumber)}</p>
            </div>
          </div>
          <div className="w-full h-6 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-green-500" style={{ width: `${Math.min(100, snapshot.firePercentage).toFixed(1)}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-xs">
            <span>Gap: {fmt_cr(snapshot.fireGap)}</span>
            <span>Annual Expenses: {fmt_cr(snapshot.annualExpenses)}</span>
          </div>
        </div>
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr className="bg-gray-100">
                <th className="px-2 py-1 text-left">Year</th>
                <th className="px-2 py-1 text-right">Portfolio Value⁷</th>
                <th className="px-2 py-1 text-right">Total Expenses⁸</th>
                <th className="px-2 py-1 text-right">Goal Payouts⁹</th>
                <th className="px-2 py-1 text-right">FIRE Number¹⁰</th>
                <th className="px-2 py-1 text-right">FIRE %¹¹</th>
              </tr>
            </thead>
            <tbody>
              {thirtyYearProjection.map((row, i) => (
                <tr key={row.year} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-1 font-medium">{row.year}</td>
                  <td className="px-2 py-1 text-right">{fmt_cr(row.portfolioValue)}</td>
                  <td className="px-2 py-1 text-right">{fmt_cr(row.expenses)}</td>
                  <td className="px-2 py-1 text-right">{row.goals > 0 ? fmt_cr(row.goals) : '—'}</td>
                  <td className="px-2 py-1 text-right">{fmt_cr(row.fireNumber)}</td>
                  <td className={`px-2 py-1 text-right font-medium ${row.firePercent >= 100 ? 'text-green-600' : ''}`}>{row.firePercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {snapshot.fiYear && (
          <p className="text-sm font-medium mb-4" style={{ color: colors.navy }}>
            Projected FI in Year {snapshot.fiYear} at FIRE % ≥ 100% (Age {snapshot.fiAge})
          </p>
        )}
        <div className="text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1"><sup>7</sup><strong>Portfolio Value:</strong> Total investable assets</p>
          <p className="mb-1"><sup>8</sup><strong>Total Expenses:</strong> Annual expenses at 6% inflation</p>
          <p className="mb-1"><sup>9</sup><strong>Goal Payouts:</strong> Lump-sum goal funding due that year</p>
          <p className="mb-1"><sup>10</sup><strong>FIRE Number:</strong> Annual Expenses × 30</p>
          <p className="mb-1"><sup>11</sup><strong>FIRE %:</strong> (Portfolio / FIRE Number) × 100</p>
        </div>
      </PageWrapper>

      {/* PAGE 3 — Financial Statement */}
      <PageWrapper pageNumber={3} title="Financial Statement">
        <p className="text-sm mb-6" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong> Healthy savings rate of {incomeExpense.savingsRate.toFixed(1)}% with monthly surplus of {fmt_in(incomeExpense.monthlySurplus)} supporting wealth growth.
        </p>
        <div className="mb-8">
          <h3 className="text-base font-bold mb-4 text-center" style={{ color: colors.navy }}>Profit / Loss (Monthly)</h3>
          <div className="grid grid-cols-2 gap-6 mb-4">
            <div className="bg-green-50 rounded-lg p-6 border-2" style={{ borderColor: colors.green }}>
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Income¹³</p>
              <p className="text-4xl font-bold mb-4" style={{ color: colors.green }}>{fmt_in(incomeExpense.monthlyIncome)}</p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span style={{ color: colors.gray[600] }}>Monthly Income</span><span className="font-medium">{fmt_in(incomeExpense.monthlyIncome)}</span></div>
                <div className="pt-2 border-t flex justify-between font-bold"><span>Total Income</span><span>{fmt_in(incomeExpense.monthlyIncome)}</span></div>
              </div>
            </div>
            <div className="bg-red-50 rounded-lg p-6 border-2" style={{ borderColor: colors.red }}>
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Expenses¹⁴</p>
              <p className="text-4xl font-bold mb-4" style={{ color: colors.red }}>{fmt_in(incomeExpense.monthlyExpense)}</p>
              <div className="space-y-2 text-xs">
                {incomeExpense.expenseBreakdown.map(e => (
                  <div key={e.category} className="flex justify-between"><span style={{ color: colors.gray[600] }}>{e.category}</span><span className="font-medium">{fmt_in(e.amount)}</span></div>
                ))}
                <div className="pt-2 border-t flex justify-between font-bold"><span>Total Expenses</span><span>{fmt_in(incomeExpense.monthlyExpense)}</span></div>
              </div>
            </div>
          </div>
          <div className="px-12">
            <div className="bg-gray-50 rounded-lg p-4 border-2" style={{ borderColor: colors.green }}>
              <div className="flex items-center justify-around">
                <div className="text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>Surplus¹⁵</p>
                  <p className="text-4xl font-bold" style={{ color: colors.green }}>{fmt_in(incomeExpense.monthlySurplus)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>Savings Rate¹⁶</p>
                  <p className="text-4xl font-bold" style={{ color: colors.green }}>{incomeExpense.savingsRate.toFixed(1)}%</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>Annual Surplus</p>
                  <p className="text-2xl font-bold" style={{ color: colors.gray[700] }}>{fmt_cr(incomeExpense.annualSurplus)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-base font-bold mb-4 text-center" style={{ color: colors.navy }}>Balance Sheet (As on {currentQuarter})</h3>
          <div className="grid grid-cols-2 gap-6 mb-4">
            <div className="bg-blue-50 rounded-lg p-6 border-2" style={{ borderColor: colors.navy }}>
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Assets¹⁷</p>
              <p className="text-4xl font-bold mb-4" style={{ color: colors.navy }}>{fmt_cr(balanceSheet.totalAssets)}</p>
              <div className="space-y-2 text-xs">
                {balanceSheet.assets.map(a => (
                  <div key={a.name} className="flex justify-between"><span style={{ color: colors.gray[600] }}>{a.name}</span><span className="font-medium">{fmt_cr(a.value)}</span></div>
                ))}
                <div className="pt-2 border-t flex justify-between font-bold"><span>Total Assets</span><span>{fmt_cr(balanceSheet.totalAssets)}</span></div>
              </div>
            </div>
            <div className="bg-orange-50 rounded-lg p-6 border-2" style={{ borderColor: '#f97316' }}>
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Liabilities¹⁸</p>
              <p className="text-4xl font-bold mb-4" style={{ color: '#f97316' }}>{fmt_cr(balanceSheet.totalLiabilities)}</p>
              <div className="space-y-2 text-xs">
                {balanceSheet.liabilities.length === 0 && <p style={{ color: colors.gray[600] }}>No outstanding loans</p>}
                {balanceSheet.liabilities.map((l, idx) => (
                  <div key={idx}>
                    <div className="flex justify-between"><span style={{ color: colors.gray[600] }}>{l.name}</span><span className="font-medium">{fmt_cr(l.outstanding)}</span></div>
                    <div className="flex justify-between"><span style={{ color: colors.gray[500] }}>EMI: {fmt_in(l.emi)}/mo</span><span className="text-xs" style={{ color: colors.gray[500] }}>{l.tenure_months} mo left</span></div>
                  </div>
                ))}
                <div className="pt-2 border-t flex justify-between font-bold"><span>Total Liabilities</span><span>{fmt_cr(balanceSheet.totalLiabilities)}</span></div>
              </div>
            </div>
          </div>
          <div className="px-12">
            <div className="bg-gray-50 rounded-lg p-4 border-2" style={{ borderColor: colors.gold }}>
              <div className="flex items-center justify-around">
                <div className="text-center"><p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>Net Worth¹⁹</p><p className="text-4xl font-bold" style={{ color: colors.gold }}>{fmt_cr(balanceSheet.netWorth)}</p></div>
                <div className="text-center"><p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>QoQ Change</p><p className="text-4xl font-bold" style={{ color: nwQoqPositive ? colors.green : colors.red }}>{nwQoqPositive ? '+' : ''}{qoqChanges.netWorth}%</p></div>
                <div className="text-center"><p className="text-sm font-medium mb-1" style={{ color: colors.gray[600] }}>Previous Quarter</p><p className="text-2xl font-bold" style={{ color: colors.gray[700] }}>{fmt_cr(balanceSheet.netWorthPrevQ)}</p></div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-8 text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1"><sup>13</sup><strong>Income:</strong> Total monthly income</p>
          <p className="mb-1"><sup>14</sup><strong>Expenses:</strong> Housing + Food + Transport + Others</p>
          <p className="mb-1"><sup>15</sup><strong>Surplus:</strong> Income − Expenses = {fmt_in(incomeExpense.monthlySurplus)}</p>
          <p className="mb-1"><sup>16</sup><strong>Savings Rate:</strong> {incomeExpense.savingsRate.toFixed(1)}%</p>
          <p className="mb-1"><sup>17</sup><strong>Assets:</strong> Total {fmt_cr(balanceSheet.totalAssets)}</p>
          <p className="mb-1"><sup>18</sup><strong>Liabilities:</strong> Total {fmt_cr(balanceSheet.totalLiabilities)}</p>
          <p className="mb-1"><sup>19</sup><strong>Net Worth:</strong> Assets − Liabilities = {fmt_cr(balanceSheet.netWorth)}</p>
        </div>
      </PageWrapper>

      {/* PAGE 4 — Net Worth */}
      <PageWrapper pageNumber={4} title="Net Worth">
        <p className="text-sm mb-6" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong> Diversified portfolio across asset classes at age {clientData.age}.
        </p>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-50 rounded-lg p-6 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Current Net Worth²⁰</p>
              <p className="text-6xl font-bold mb-3" style={{ color: colors.navy }}>{fmt_cr(snapshot.netWorth)}</p>
              <div className="flex items-center justify-center gap-2"><Badge value={qoqChanges.netWorth} positive={nwQoqPositive} /><span className="text-sm" style={{ color: colors.gray[600] }}>vs {previousQuarter}</span></div>
              <p className="text-xs mt-3" style={{ color: colors.gray[500] }}>Previous Quarter: {fmt_cr(snapshot.netWorthPrevQ)}</p>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-6">
            <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>Net Worth Distribution²¹</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={netWorthPage.pieData.filter(d => d.value > 0)} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percentage }: { name: string; percentage: number }) => `${name}: ${percentage}%`} labelLine={true}>
                  <Cell fill={colors.navy} />
                  <Cell fill={colors.gray[600]} />
                  <Cell fill={colors.gold} />
                  <Cell fill={colors.green} />
                </Pie>
                <Tooltip formatter={(v: number) => fmt_cr(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-5">
          <h3 className="text-sm font-semibold" style={{ color: colors.navy }}>Quarterly Performance Trends (Last 3 Quarters) — *Estimated</h3>
          {[
            { label: 'Equity (MF + Direct)', data: netWorthPage.equityTrend, color: colors.navy },
            { label: 'Debt (FD + PPF/EPF)', data: netWorthPage.debtTrend, color: colors.gold },
            { label: 'Real Estate', data: netWorthPage.realEstateTrend, color: colors.gray[600] },
            { label: 'Gold & Cash', data: netWorthPage.goldCashTrend, color: colors.gray[300] },
          ].map(cat => (
            <div key={cat.label} className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium mb-3" style={{ color: colors.gray[600] }}>{cat.label}</p>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={cat.data} margin={{ top: 10, right: 20, bottom: 10, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.gray[200]} />
                  <XAxis dataKey="q" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}L`} />
                  <Tooltip formatter={(v: number) => `₹${v} L`} />
                  <Line type="monotone" dataKey="value" stroke={cat.color} strokeWidth={3} dot={{ r: 5, fill: cat.color }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        <div className="mt-6 text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1"><sup>20</sup><strong>Net Worth:</strong> Total Assets − Total Liabilities</p>
          <p className="mb-1"><sup>21</sup><strong>Asset Allocation:</strong> Distribution across asset classes</p>
        </div>
      </PageWrapper>

      {/* PAGE 5 — Goals Planning */}
      <PageWrapper pageNumber={5} title="Goals Planning">
        <p className="text-sm mb-4" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong> Total goal funding requirement of {fmt_in(goalsTotal.monthlySavingsReq)}/month.
        </p>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr className="bg-gray-100">
                <th className="px-2 py-1 text-left">No.</th>
                <th className="px-2 py-1 text-left">Goal Name</th>
                <th className="px-2 py-1 text-right">Today Cost</th>
                <th className="px-2 py-1 text-right">Target Year</th>
                <th className="px-2 py-1 text-right">Yrs</th>
                <th className="px-2 py-1 text-right">Monthly SIP²²</th>
                <th className="px-2 py-1 text-right">Yearly</th>
                <th className="px-2 py-1 text-right">Future Value²³</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((goal, i) => (
                <tr key={goal.no} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-1">Goal {goal.no}</td>
                  <td className="px-2 py-1 font-medium">{goal.name}</td>
                  <td className="px-2 py-1 text-right">{goal.todayCost > 0 ? fmt_cr(goal.todayCost) : '—'}</td>
                  <td className="px-2 py-1 text-right">{goal.targetYear}</td>
                  <td className="px-2 py-1 text-right">{goal.timeInHand}</td>
                  <td className="px-2 py-1 text-right font-medium">{fmt_in(goal.monthlySavingsReq)}</td>
                  <td className="px-2 py-1 text-right">{fmt_cr(goal.yearlySavingsReq)}</td>
                  <td className="px-2 py-1 text-right">{fmt_cr(goal.futureValue)}</td>
                </tr>
              ))}
              <tr className="bg-yellow-100 font-bold">
                <td colSpan={5} className="px-2 py-1">Total Savings Required</td>
                <td className="px-2 py-1 text-right">{fmt_in(goalsTotal.monthlySavingsReq)}</td>
                <td className="px-2 py-1 text-right">{fmt_cr(goalsTotal.yearlySavingsReq)}</td>
                <td className="px-2 py-1 text-right">{fmt_cr(goalsTotal.futureValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: colors.navy }}>Year-by-Year Savings Requirement²⁴</h3>
          <div className="overflow-y-auto" style={{ maxHeight: '320px' }}>
            <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead className="sticky top-0 bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Year</th>
                  <th className="px-3 py-2 text-right">Monthly Savings Required</th>
                  <th className="px-3 py-2 text-right">Yearly Savings Required</th>
                </tr>
              </thead>
              <tbody>
                {yearlyGoalRequirements.map((row, i) => (
                  <tr key={row.year} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-1">{row.year}</td>
                    <td className="px-3 py-1 text-right">{fmt_in(row.monthly_required)}</td>
                    <td className="px-3 py-1 text-right">{fmt_in(row.yearly_required)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1"><strong>Assumptions:</strong> Inflation²⁵: 6% | SIP Return: 10% | FV Growth: 8%</p>
          <p className="mb-1"><sup>22</sup><strong>Monthly SIP:</strong> PMT formula to accumulate future value</p>
          <p className="mb-1"><sup>23</sup><strong>Future Value:</strong> Today's cost × (1.08)^years</p>
          <p className="mb-1"><sup>24</sup><strong>Year-by-Year:</strong> Aggregated commitment across active goals</p>
          <p className="mb-1"><sup>25</sup><strong>Inflation:</strong> 6% annual cost-of-living increase</p>
        </div>
      </PageWrapper>

      {/* PAGE 6 — Insurance */}
      <PageWrapper pageNumber={6} title="Insurance">
        <p className="text-sm mb-6" style={{ color: colors.gray[700] }}>
          <strong>Executive Insight:</strong>{' '}
          {insurance.termLife.gap > 0 ? `Term life gap of ${fmt_cr(insurance.termLife.gap)} identified. ` : 'Term life adequately covered. '}
          {insurance.health.gap > 0 ? `Health gap of ${fmt_cr(insurance.health.gap)} identified.` : `Health cover of ${fmt_cr(insurance.health.have)} is adequate.`}
        </p>
        {/* Term Life */}
        <div className="mb-8">
          <h3 className="text-lg font-bold mb-4" style={{ color: colors.navy }}>Term Life Insurance²⁶</h3>
          <div className="bg-gray-50 rounded-lg p-6">
            <div className="grid grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={[{ name: 'Current', value: insurance.termLife.have }, { name: 'Recommended', value: insurance.termLife.recommended }]} margin={{ top: 10, right: 10, bottom: 40, left: 60 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 10_000_000).toFixed(1)}Cr`} />
                  <Bar dataKey="value"><Cell fill={colors.gold} /><Cell fill={colors.navy} /></Bar>
                  <Tooltip formatter={(v: number) => fmt_cr(v)} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-col justify-center space-y-4">
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.lightGreen, border: `1px solid ${colors.gold}` }}>
                  <span className="text-sm font-medium">Current</span>
                  <span className="text-xl font-bold" style={{ color: colors.gold }}>{fmt_cr(insurance.termLife.have)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'rgba(30,58,95,0.05)', border: `1px solid ${colors.navy}` }}>
                  <span className="text-sm font-medium">Recommended</span>
                  <span className="text-xl font-bold" style={{ color: colors.navy }}>{fmt_cr(insurance.termLife.recommended)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: insurance.termLife.gap > 0 ? colors.lightRed : colors.lightGreen, border: `1px solid ${insurance.termLife.gap > 0 ? colors.red : colors.green}` }}>
                  <span className="text-sm font-medium">{insurance.termLife.gap > 0 ? 'Shortfall' : 'Status'}</span>
                  <span className="text-xl font-bold" style={{ color: insurance.termLife.gap > 0 ? colors.red : colors.green }}>{insurance.termLife.gap > 0 ? fmt_cr(insurance.termLife.gap) : '✓ Adequate'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Health */}
        <div className="mb-8">
          <h3 className="text-lg font-bold mb-4" style={{ color: colors.navy }}>Health Insurance²⁷</h3>
          <div className="bg-gray-50 rounded-lg p-6">
            <div className="grid grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={[{ name: 'Current', value: insurance.health.have }, { name: 'Recommended', value: insurance.health.recommended }]} margin={{ top: 10, right: 10, bottom: 40, left: 60 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 100_000).toFixed(0)}L`} />
                  <Bar dataKey="value"><Cell fill={colors.gold} /><Cell fill={colors.navy} /></Bar>
                  <Tooltip formatter={(v: number) => fmt_cr(v)} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-col justify-center space-y-4">
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: colors.lightGreen, border: `1px solid ${colors.green}` }}>
                  <span className="text-sm font-medium">Current</span>
                  <span className="text-xl font-bold" style={{ color: colors.green }}>{fmt_cr(insurance.health.have)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'rgba(30,58,95,0.05)', border: `1px solid ${colors.navy}` }}>
                  <span className="text-sm font-medium">Recommended</span>
                  <span className="text-xl font-bold" style={{ color: colors.navy }}>{fmt_cr(insurance.health.recommended)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: insurance.health.gap > 0 ? colors.lightRed : 'rgba(34,197,94,0.15)', border: `1px solid ${insurance.health.gap > 0 ? colors.red : colors.green}` }}>
                  <span className="text-sm font-medium">{insurance.health.gap > 0 ? 'Shortfall' : 'Status'}</span>
                  <span className="text-xl font-bold" style={{ color: insurance.health.gap > 0 ? colors.red : colors.green }}>{insurance.health.gap > 0 ? fmt_cr(insurance.health.gap) : '✓ Adequate'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Additional Recommendations */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6" style={{ border: `1px solid ${colors.gold}` }}>
          <p className="text-sm font-semibold mb-3" style={{ color: colors.navy }}>Additional Coverage Recommendations:</p>
          <div className="grid grid-cols-2 gap-4 text-xs">
            {[
              { title: 'Critical Illness Rider', desc: '₹50L for serious illnesses' },
              { title: 'Accidental Death Benefit', desc: 'Additional ₹1 Cr accidental death' },
              { title: 'Disability Income', desc: 'Monthly income replacement' },
              { title: 'Parents Health Cover', desc: '₹10L for parents if uncovered' },
            ].map(r => (
              <div key={r.title} className="flex items-start gap-2">
                <Shield className="w-4 h-4 mt-0.5" style={{ color: colors.gold }} />
                <div><p className="font-medium" style={{ color: colors.navy }}>{r.title}</p><p style={{ color: colors.gray[600] }}>{r.desc}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs leading-relaxed" style={{ color: colors.gray[500] }}>
          <p className="mb-1">• <strong>Term Life</strong> = Max(15× Annual Income, Liabilities + 10yr Expenses)</p>
          <p className="mb-1">• <strong>Health Insurance</strong> = 4× Monthly Income or ₹20L minimum</p>
          <p className="mb-1"><sup>26</sup>Term Life: Pure life protection, no investment component</p>
          <p className="mb-1"><sup>27</sup>Health: Hospitalization and treatment coverage</p>
        </div>
        {/* Quarter-end Summary */}
        <div className="mt-8 p-6 rounded-lg" style={{ backgroundColor: colors.navy, color: 'white' }}>
          <h3 className="text-base font-bold mb-4">Quarter End Summary</h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><p className="opacity-80 mb-1">Net Worth</p><p className="text-xl font-bold">{summaryQuarter.netWorth}</p></div>
            <div><p className="opacity-80 mb-1">FIRE Progress</p><p className="text-xl font-bold">{summaryQuarter.fireProgress}</p></div>
            <div><p className="opacity-80 mb-1">Savings Rate</p><p className="text-xl font-bold">{summaryQuarter.savingsRate}</p></div>
            <div><p className="opacity-80 mb-1">Next Review</p><p className="text-xl font-bold">{summaryQuarter.nextReview}</p></div>
          </div>
        </div>
      </PageWrapper>
    </div>
  );
};

export default VelvetWealthHealthReport;
