'use client'

import { useState } from 'react'
import { SectionPanel } from '@/components/mapping/SectionPanel'
import { DebtPanel } from '@/components/mapping/DebtPanel'
import { InstallmentPanel } from '@/components/mapping/InstallmentPanel'
import { SavingPanel } from '@/components/mapping/SavingPanel'
import { CashflowSummary } from '@/components/mapping/CashflowSummary'
import type {
  MappingRow, AnnualRow, DebtRow, InstallmentRow, SavingRow,
} from '@/stores/mappingStore'
import type { GeneratedMapping } from '@/lib/autoMap'
import type { Transaction } from '@/types/transaction'

// The auto-mapping lab renders the AI result through the EXACT same panels as
// the real mapping tab (SectionPanel / DebtPanel / InstallmentPanel /
// SavingPanel / CashflowSummary), so the lab looks 1:1 with what the advisor
// sees after a manual mapping — and any future change to those panels flows
// here for free.
//
// The AI result (GeneratedMapping) is the store row shapes minus `id`, so we
// adapt each section to id-bearing rows (id = `${section}-${index}`) on the
// way in, and translate the panels' id-based callbacks back to index-based
// edits on the way out. Nothing here touches the real mappingStore — edits go
// through onChange (the lab's isolated autoMapStore.updateResult).
//
// Lab-only extras kept "on the side": per-row confidence/source chips (via
// SectionPanel's optional rowExtra slot) and the variable sub-row breakdown
// grouped by category with a transactions drill-down.

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

const inputCls =
  'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60'

// Confidence + source chip — same look as the previous lab render, preserved
// as an extra the mapping tab doesn't have.
function RowMetaChip({ confidence, source }: { confidence?: 'high' | 'medium' | 'low'; source?: string }) {
  if (!confidence && !source) return null
  const palette: Record<string, string> = {
    high:   'border-income/40 text-income bg-income/10',
    medium: 'border-gold/40 text-gold bg-gold/10',
    low:    'border-expense/40 text-expense bg-expense/10',
  }
  const label: Record<string, string> = { high: 'אמין', medium: 'בינוני', low: 'נמוך' }
  const cls     = (confidence && palette[confidence]) ?? 'border-line text-muted-txt bg-surface'
  const confTxt = confidence ? label[confidence] : ''
  const tooltip = [confTxt ? `אמינות: ${confTxt}` : '', source ? `מקור: ${source}` : ''].filter(Boolean).join(' · ')
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 max-w-[110px] truncate ${cls}`}
      title={tooltip}
    >
      {source ?? confTxt}
    </span>
  )
}

interface Props {
  result: GeneratedMapping
  txns: Transaction[]
  onChange: (patch: Partial<GeneratedMapping>) => void
}

type SimpleKey = 'income' | 'fixed' | 'sub' | 'ins'

export function LabMappingView({ result, txns, onChange }: Props) {
  // Which variable-category group has its underlying transactions expanded.
  const [openCategoryTxns, setOpenCategoryTxns] = useState<string | null>(null)

  const idxOf = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1))
  const asNum = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v) || 0)

  const patch = <K extends keyof GeneratedMapping>(key: K, rows: GeneratedMapping[K]) =>
    onChange({ [key]: rows } as Partial<GeneratedMapping>)

  // ── edit / add / delete helpers (index-based, mirror the old lab logic) ──
  function editSimple(key: SimpleKey, idx: number, field: 'name' | 'amount', value: string | number) {
    const rows = [...result[key]]
    rows[idx] = { ...rows[idx], [field]: field === 'amount' ? asNum(value) : String(value) }
    patch(key, rows)
  }
  function editVariable(idx: number, field: 'name' | 'amount', value: string | number) {
    const rows = [...result.variable]
    rows[idx] = { ...rows[idx], [field]: field === 'amount' ? asNum(value) : String(value) }
    patch('variable', rows)
  }
  function editAnnual(idx: number, field: 'name' | 'annualAmount', value: string | number) {
    const rows = [...result.annual]
    rows[idx] = { ...rows[idx], [field]: field === 'annualAmount' ? asNum(value) : String(value) }
    patch('annual', rows)
  }
  function editComplex<K extends 'debts' | 'installments' | 'savings'>(key: K, idx: number, field: string, value: string | number) {
    const rows = [...(result[key] as unknown as Record<string, unknown>[])]
    rows[idx] = { ...rows[idx], [field]: field === 'name' ? String(value) : asNum(value) }
    patch(key, rows as unknown as GeneratedMapping[K])
  }
  function delRow<K extends keyof GeneratedMapping>(key: K, idx: number) {
    if (!Array.isArray(result[key])) return
    patch(key, (result[key] as unknown[]).filter((_, i) => i !== idx) as GeneratedMapping[K])
  }
  function addSimple(key: SimpleKey | 'variable') {
    patch(key, [...result[key], { name: '', amount: 0 }])
  }
  function addAnnual() {
    patch('annual', [...result.annual, { name: '', annualAmount: 0 }])
  }
  function addComplex(key: 'debts' | 'installments' | 'savings') {
    const defaults: Record<string, Record<string, unknown>> = {
      debts:        { name: '', originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0, monthlyPayment: 0 },
      installments: { name: '', totalAmount: 0, monthlyPayment: 0, paidCount: 0, totalCount: 0 },
      savings:      { name: '', monthlyContribution: 0, accumulated: 0, feeBalance: 0, feeDeposit: 0 },
    }
    patch(key, [...(result[key] as unknown as Record<string, unknown>[]), defaults[key]] as unknown as GeneratedMapping[typeof key])
  }

  // ── adapters: GeneratedMapping rows → id-bearing panel rows ──
  const simpleRows = (key: SimpleKey): MappingRow[] =>
    result[key].map((r, i) => ({ id: `${key}-${i}`, name: r.name, amount: r.amount }))
  const annualRows: AnnualRow[] =
    result.annual.map((r, i) => ({ id: `annual-${i}`, name: r.name, annualAmount: r.annualAmount }))
  const debtRows: DebtRow[] =
    result.debts.map((r, i) => ({ id: `debts-${i}`, name: r.name, originalBalance: r.originalBalance, remainingBalance: r.remainingBalance, interestRate: r.interestRate, remainingMonths: r.remainingMonths, monthlyPayment: r.monthlyPayment }))
  const installmentRows: InstallmentRow[] =
    result.installments.map((r, i) => ({ id: `installments-${i}`, name: r.name, totalAmount: r.totalAmount, monthlyPayment: r.monthlyPayment, paidCount: r.paidCount, totalCount: r.totalCount }))
  const savingRows: SavingRow[] =
    result.savings.map((r, i) => ({ id: `savings-${i}`, name: r.name, monthlyContribution: r.monthlyContribution, accumulated: r.accumulated, feeBalance: r.feeBalance, feeDeposit: r.feeDeposit }))
  const variableRows: MappingRow[] =
    result.variable.map((r, i) => ({ id: `variable-${i}`, name: r.name, amount: r.amount }))

  // Confidence/source chip for a simple-section row, looked up by id.
  const chipFor = (key: SimpleKey) => (row: MappingRow) => {
    const r = result[key][idxOf(row.id)]
    return r ? <RowMetaChip confidence={r.confidence} source={r.source} /> : null
  }

  const totalAnnualMo = Math.round(result.annual.reduce((s, r) => s + r.annualAmount, 0) / 12)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* שורה 1: הכנסות | קבועות */}
        <SectionPanel
          title="הכנסות חודשיות"
          icon="💰"
          rows={simpleRows('income')}
          totalLabel="סה&quot;כ הכנסות"
          totalColor="text-income"
          colName="מקור הכנסה"
          rowExtra={chipFor('income')}
          onAdd={() => addSimple('income')}
          onUpdate={(id, field, value) => editSimple('income', idxOf(id), field, value)}
          onDelete={id => delRow('income', idxOf(id))}
        />
        <SectionPanel
          title="הוצאות קבועות"
          icon="📌"
          rows={simpleRows('fixed')}
          totalLabel="סה&quot;כ קבועות"
          colName="סוג הוצאה"
          colAmt="סכום חודשי ₪"
          rowExtra={chipFor('fixed')}
          onAdd={() => addSimple('fixed')}
          onUpdate={(id, field, value) => editSimple('fixed', idxOf(id), field, value)}
          onDelete={id => delRow('fixed', idxOf(id))}
        />

        {/* שורה 2: מנויים | ביטוחים */}
        <SectionPanel
          title="מינויים ומנויים"
          icon="🔄"
          rows={simpleRows('sub')}
          totalLabel="סה&quot;כ מנויים"
          colName="שם המנוי"
          rowExtra={chipFor('sub')}
          onAdd={() => addSimple('sub')}
          onUpdate={(id, field, value) => editSimple('sub', idxOf(id), field, value)}
          onDelete={id => delRow('sub', idxOf(id))}
        />
        <SectionPanel
          title="ביטוחים"
          icon="🛡️"
          rows={simpleRows('ins')}
          totalLabel="סה&quot;כ ביטוחים"
          colName="סוג הביטוח"
          colAmt="פרמיה חודשית ₪"
          rowExtra={chipFor('ins')}
          onAdd={() => addSimple('ins')}
          onUpdate={(id, field, value) => editSimple('ins', idxOf(id), field, value)}
          onDelete={id => delRow('ins', idxOf(id))}
        />

        {/* שורה 3: שנתיות — רוחב מלא (זהה לטאב המיפוי) */}
        <div className="md:col-span-2">
          <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <h2 className="font-semibold text-txt">📅 הוצאות שנתיות</h2>
              <span className="text-xs text-muted-txt">
                שנתי: <span className="font-bold text-expense">{fmt(result.annual.reduce((s, r) => s + r.annualAmount, 0))}</span>
                <span className="mx-1.5">|</span>
                לחודש: <span className="font-bold text-gold">{fmt(totalAnnualMo)}</span>
              </span>
            </div>
            {/* Desktop headers */}
            <div className="hidden sm:grid grid-cols-[1fr_6rem_5rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
              <span>סוג הוצאה</span>
              <span className="text-left">סכום שנתי ₪</span>
              <span className="text-center">לחודש</span>
              <span />
            </div>
            <div className="space-y-2">
              {annualRows.map(row => (
                <div key={row.id} className="group">
                  {/* Desktop row */}
                  <div className="hidden sm:grid grid-cols-[1fr_6rem_5rem_1.5rem] gap-2 items-center">
                    <input value={row.name} onChange={e => editAnnual(idxOf(row.id), 'name', e.target.value)} placeholder="שם ההוצאה"
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                    <input type="number" value={row.annualAmount || ''} onChange={e => editAnnual(idxOf(row.id), 'annualAmount', parseFloat(e.target.value) || 0)}
                      placeholder="₪" min={0} style={{ direction: 'ltr' }}
                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                    <span className="text-xs text-center px-1 py-1.5 rounded border border-line bg-surface text-muted-txt tabular-nums">
                      {fmt(Math.round(row.annualAmount / 12))}
                    </span>
                    <button onClick={() => delRow('annual', idxOf(row.id))}
                      className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm">×</button>
                  </div>
                  {/* Mobile card */}
                  <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input value={row.name} onChange={e => editAnnual(idxOf(row.id), 'name', e.target.value)} placeholder="שם ההוצאה"
                        className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                      <button onClick={() => delRow('annual', idxOf(row.id))} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-0.5">
                        <div className="text-[10px] text-muted-txt px-1">סכום שנתי ₪</div>
                        <input type="number" value={row.annualAmount || ''} onChange={e => editAnnual(idxOf(row.id), 'annualAmount', parseFloat(e.target.value) || 0)}
                          placeholder="₪" min={0} style={{ direction: 'ltr' }}
                          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                      </div>
                      <div className="shrink-0 text-center space-y-0.5">
                        <div className="text-[10px] text-muted-txt px-1">לחודש</div>
                        <span className="block text-xs px-3 py-1.5 rounded border border-line bg-surface text-muted-txt tabular-nums">
                          {fmt(Math.round(row.annualAmount / 12))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {annualRows.length === 0 && (
                <p className="text-xs text-muted-txt py-2">אין שורות עדיין</p>
              )}
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-line">
              <button onClick={addAnnual} className="text-xs text-muted-txt hover:text-gold transition-colors">
                + הוסף שורה
              </button>
              <span className="text-xs text-muted-txt">
                סה&quot;כ שנתי: <span className="font-medium text-expense">{fmt(result.annual.reduce((s, r) => s + r.annualAmount, 0))}</span>
                <span className="mx-1">|</span>
                לחודש: <span className="font-medium text-gold">{fmt(totalAnnualMo)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* שורה 4: משתנות — רוחב מלא. תצוגת המעבדה: קיבוץ לפי קטגוריה + תת-שורות
            + פירוט העסקאות הגולמיות. שומר על הפירוק העשיר של ה-AI. */}
        <div className="md:col-span-2">
          {(() => {
            const rows = result.variable.map((r, i) => ({ ...r, _idx: i }))
            type VarGroup = { category: string; rows: typeof rows }
            const groupsMap = new Map<string, VarGroup>()
            for (const r of rows) {
              const cat = r.category?.trim() || 'ללא קטגוריה'
              const g = groupsMap.get(cat) ?? { category: cat, rows: [] }
              g.rows.push(r)
              groupsMap.set(cat, g)
            }
            const groups = [...groupsMap.values()].sort((a, b) =>
              b.rows.reduce((s, r) => s + r.amount, 0) - a.rows.reduce((s, r) => s + r.amount, 0))

            return (
              <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-txt">🛒 הוצאות משתנות</h2>
                  <span className="text-sm font-bold text-gold">
                    {fmt(result.variable.reduce((s, r) => s + r.amount, 0))}<span className="text-xs font-normal text-muted-txt">/חודש</span>
                  </span>
                </div>

                {groups.length === 0 && (
                  <p className="text-xs text-muted-txt py-2">אין שורות — לחץ &quot;+ הוסף שורה&quot; כדי להוסיף ידנית</p>
                )}

                {groups.map(g => {
                  const groupTotal = g.rows.reduce((s, r) => s + r.amount, 0)
                  const matchingTxns = txns.filter(t => !t.isRefund && t.category === g.category)
                  const isOpen = openCategoryTxns === g.category
                  return (
                    <div key={g.category} className="rounded-lg border border-line/60 bg-surface/40 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gold">{g.category}</span>
                        <span className="text-[10px] text-muted-txt tabular-nums">{g.rows.length} שורות · {fmt(groupTotal)}</span>
                      </div>

                      {g.rows.map(r => (
                        <div key={r._idx} className="flex items-center gap-2 group flex-wrap">
                          <input value={r.name} onChange={e => editVariable(r._idx, 'name', e.target.value)} className={`${inputCls} flex-1 min-w-[100px]`} placeholder="שם" />
                          <RowMetaChip confidence={r.confidence} source={r.source} />
                          <input type="number" value={r.amount || ''} onChange={e => editVariable(r._idx, 'amount', e.target.value)} style={{ direction: 'ltr' }} className={`${inputCls} w-28 text-left tabular-nums`} placeholder="₪" />
                          <button onClick={() => delRow('variable', r._idx)} className="size-7 flex items-center justify-center text-muted-txt hover:text-expense sm:opacity-0 sm:group-hover:opacity-100 text-base rounded">×</button>
                        </div>
                      ))}

                      {matchingTxns.length > 0 && (
                        <>
                          <button
                            onClick={() => setOpenCategoryTxns(isOpen ? null : g.category)}
                            className="w-full text-start text-[11px] px-2 py-1 rounded border border-line bg-surface hover:border-gold/40 hover:text-gold transition-colors flex items-center justify-between gap-2"
                          >
                            <span>📊 פירוט: {matchingTxns.length} עסקאות מהדוחות</span>
                            <span>{isOpen ? '▲' : '▶'}</span>
                          </button>
                          {isOpen && (
                            <div className="rounded-lg border border-line overflow-x-auto">
                              <table className="w-full text-[11px]">
                                <thead className="bg-surface2 border-b border-line">
                                  <tr>
                                    <th className="text-start px-2 py-1 font-medium text-muted-txt">תיאור</th>
                                    <th className="text-start px-2 py-1 font-medium text-muted-txt whitespace-nowrap">תאריך</th>
                                    <th className="text-end px-2 py-1 font-medium text-muted-txt">סכום</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line/50">
                                  {[...matchingTxns].sort((a, b) => b.amount - a.amount).map((t, i) => (
                                    <tr key={i} className="hover:bg-surface2/40">
                                      <td className="px-2 py-1 max-w-[200px] truncate text-txt">{t.desc}</td>
                                      <td className="px-2 py-1 text-muted-txt whitespace-nowrap">{t.date}</td>
                                      <td className="px-2 py-1 text-end font-medium text-gold tabular-nums whitespace-nowrap">{fmt(t.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}

                <div className="pt-1 border-t border-line">
                  <button onClick={() => addSimple('variable')} className="text-xs text-muted-txt hover:text-gold transition-colors">
                    + הוסף שורה
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Full-width sections — identical panels to the mapping tab */}
      <DebtPanel
        debts={debtRows}
        onAdd={() => addComplex('debts')}
        onUpdate={(id, field, value) => editComplex('debts', idxOf(id), field, value)}
        onDelete={id => delRow('debts', idxOf(id))}
      />
      <InstallmentPanel
        installments={installmentRows}
        onAdd={() => addComplex('installments')}
        onUpdate={(id, field, value) => editComplex('installments', idxOf(id), field, value)}
        onDelete={id => delRow('installments', idxOf(id))}
      />
      <SavingPanel
        savings={savingRows}
        onAdd={() => addComplex('savings')}
        onUpdate={(id, field, value) => editComplex('savings', idxOf(id), field, value)}
        onDelete={id => delRow('savings', idxOf(id))}
      />

      {/* Live cashflow summary — AI amounts are already monthly, so varMonths=1 */}
      <CashflowSummary
        income={simpleRows('income')}
        fixed={simpleRows('fixed')}
        sub={simpleRows('sub')}
        ins={simpleRows('ins')}
        variable={variableRows}
        annual={annualRows}
        debts={debtRows}
        installments={installmentRows}
        savings={savingRows}
        varMonths={1}
      />
    </div>
  )
}
