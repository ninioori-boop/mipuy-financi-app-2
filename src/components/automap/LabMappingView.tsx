'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CategoryPicker } from '@/components/shared/CategoryPicker'
import { SectionPanel } from '@/components/mapping/SectionPanel'
import { DebtPanel } from '@/components/mapping/DebtPanel'
import { InstallmentPanel } from '@/components/mapping/InstallmentPanel'
import { SavingPanel } from '@/components/mapping/SavingPanel'
import { CreditCardsPanel } from '@/components/mapping/CreditCardsPanel'
import { BankAccountsPanel } from '@/components/mapping/BankAccountsPanel'
import { CashflowSummary } from '@/components/mapping/CashflowSummary'
import type {
  MappingRow, AnnualRow, DebtRow, InstallmentRow, SavingRow, CreditCardRow, BankAccountRow,
} from '@/stores/mappingStore'
import { sectionOfCategory, SECTION_LABEL_HE, type GeneratedMapping, type MappingSection } from '@/lib/autoMap'
import { normalizeForLookup } from '@/lib/normalizeForLookup'
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
  /** Everything parsed, credit AND bank — a bank-only category needs detail too. */
  txns: Transaction[]
  /** Deposits, so an income row can show which ones it was built from. */
  incomeRows?: { desc: string; amount: number; date: string }[]
  /** Window length, so a period total can be shown as the monthly figure. */
  months?: number
  onChange: (patch: Partial<GeneratedMapping>) => void
}

type SimpleKey = 'income' | 'fixed' | 'sub' | 'ins'

export function LabMappingView({ result, txns, incomeRows = [], months = 1, onChange }: Props) {
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

  // Profile snapshot editors (credit cards / bank accounts). `?? []` guards
  // drafts saved before these fields existed.
  function editCard(idx: number, field: string, value: string | number) {
    const rows = [...(result.creditCards ?? [])]
    rows[idx] = { ...rows[idx], [field]: field === 'name' ? String(value) : asNum(value) }
    patch('creditCards', rows)
  }
  function editAccount(idx: number, field: string, value: string | number) {
    const rows = [...(result.bankAccounts ?? [])]
    rows[idx] = { ...rows[idx], [field]: field === 'name' ? String(value) : asNum(value) }
    patch('bankAccounts', rows)
  }
  function addCard() {
    patch('creditCards', [...(result.creditCards ?? []), { name: '', limit: 0, chargeDay: 2 }])
  }
  function addAccount() {
    patch('bankAccounts', [...(result.bankAccounts ?? []), { name: '', balance: 0, overdraftLimit: 0 }])
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
  const creditCardRows: CreditCardRow[] =
    (result.creditCards ?? []).map((r, i) => ({ id: `creditCards-${i}`, name: r.name, limit: r.limit, chargeDay: r.chargeDay || 2 }))
  const bankAccountRows: BankAccountRow[] =
    (result.bankAccounts ?? []).map((r, i) => ({ id: `bankAccounts-${i}`, name: r.name, balance: r.balance, overdraftLimit: r.overdraftLimit }))

  // ── category editing, and the row move that follows from it ──
  //
  // "Rows land in the wrong section" was the advisor's most common complaint,
  // and until now the only remedy was deleting the row and retyping it in the
  // right panel. Picking a category now MOVES the row, because the category
  // already determines the section (sectionOfCategory — the same function that
  // tags the data we send the model, so the two can never disagree).
  //
  // Only the five sections that share the {name, amount} shape take part.
  // `annual` is deliberately excluded: it stores annualAmount and means a
  // yearly sum, so silently moving a row in or out of it would change what the
  // number means. Its category still updates.
  const MOVABLE: Partial<Record<MappingSection, SimpleKey | 'variable'>> = {
    income: 'income', fixed: 'fixed', variable: 'variable', sub: 'sub', ins: 'ins',
  }

  function setCategory(key: SimpleKey | 'variable', idx: number, cat: string) {
    const rows = [...result[key]]
    const row  = rows[idx]
    if (!row) return

    const target  = sectionOfCategory(cat)
    const destKey = target ? MOVABLE[target] : undefined

    // debts has its own row shape, so it cannot ride the generic move above.
    // What we do not know about the loan stays 0 rather than invented — the
    // advisor fills the balance and rate in, or leaves them empty.
    if (target === 'debts') {
      onChange({
        [key]: rows.filter((_, i) => i !== idx),
        debts: [...result.debts, {
          name: row.name, monthlyPayment: row.amount,
          originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0,
          confidence: row.confidence, source: row.source, reviewed: row.reviewed,
        }],
      } as Partial<GeneratedMapping>)
      toast.success(`"${row.name || 'השורה'}" הועברה להלוואות`)
      return
    }

    if (destKey && destKey !== key) {
      onChange({
        [key]:     rows.filter((_, i) => i !== idx),
        [destKey]: [...result[destKey], { ...row, category: cat }],
      } as Partial<GeneratedMapping>)
      toast.success(`"${row.name || 'השורה'}" הועברה ל${SECTION_LABEL_HE[target!]}`)
      return
    }

    rows[idx] = { ...row, category: cat }
    patch(key, rows)
  }

  // Row extras: the category picker (editable) + the confidence/source chip.
  const chipFor = (key: SimpleKey) => (row: MappingRow) => {
    const i = idxOf(row.id)
    const r = result[key][i]
    if (!r) return null
    // SectionPanel's row is a non-wrapping flex: name (flex-1) · rowExtra ·
    // amount group (shrink-0) · delete. Anything here marked shrink-0 cannot
    // give way, so when the row exceeds the card it spills outside the border
    // instead of compressing — which is exactly what these two chips did.
    // `min-w-0` + capped widths let both truncate; the source chip, being
    // informational rather than actionable, gives up its space first.
    return (
      <span className="flex items-center gap-1 min-w-0">
        <CategoryPicker
          value={r.category ?? ''}
          onChange={cat => setCategory(key, i, cat)}
          variant="chip"
          placeholder="קטגוריה"
          className="max-w-[112px]"
        />
        <span className="hidden sm:flex min-w-0">
          <RowMetaChip confidence={r.confidence} source={r.source} />
        </span>
      </span>
    )
  }

  // Drill-down transactions for a fixed/sub/ins row — the parsed report lines
  // whose category matches the AI row's category. Gives every expense section
  // the same "▶ N פריטים" breakdown the mapping tab shows, so the advisor can
  // see exactly which charges make up each category.
  const txnsForCategory = (cat?: string): Transaction[] =>
    cat ? txns.filter(t => !t.isRefund && t.category === cat) : []
  const resolveTxnsFor = (key: SimpleKey) => (row: MappingRow): Transaction[] =>
    txnsForCategory(result[key][idxOf(row.id)]?.category)

  // Income has no category to match on — its rows are named after the payer.
  // Matching on the normalized name is how a row of ₪23,671 finally admits it
  // is two reserve-duty deposits summed over three months. This was the single
  // hardest number in the mapping to check, because it was the only one with no
  // way to open it up at all.
  const resolveIncomeTxns = (row: MappingRow): Transaction[] => {
    const key = normalizeForLookup(row.name)
    if (!key) return []
    return incomeRows
      .filter(r => {
        const k = normalizeForLookup(r.desc)
        return !!k && (k === key || k.includes(key) || key.includes(k))
      })
      .map(r => ({
        desc: r.desc, amount: r.amount, originalAmount: null, category: 'הכנסות',
        source: 'עו"ש', notes: '', date: r.date,
        installment: null, isStandingOrder: false, isRefund: false,
      }))
  }

  const totalAnnualMo = Math.round(result.annual.reduce((s, r) => s + r.annualAmount, 0) / 12)

  const creditScore = result.creditScore ?? 0

  // ── the review queue ──
  //
  // Nobody reviews forty rows — not the advisor, and certainly not a client, who
  // would approve the lot or walk away. But the model already tells us which
  // rows it was unsure of, and that turns a seven-screen read into a handful of
  // questions. It is also the precondition for ever opening this tool up: the
  // review has to be short before it can be someone else's job.
  const QUEUE_SECTIONS: (SimpleKey | 'variable')[] = ['income', 'fixed', 'variable', 'sub', 'ins']
  const reviewQueue = QUEUE_SECTIONS.flatMap(key =>
    result[key]
      .map((r, i) => ({ key, idx: i, row: r }))
      .filter(({ row }) => !row.reviewed && (row.confidence === 'low' || row.confidence === 'medium')),
  )

  function markReviewed(key: SimpleKey | 'variable', idx: number) {
    const rows = [...result[key]]
    if (!rows[idx]) return
    rows[idx] = { ...rows[idx], reviewed: true }
    patch(key, rows)
  }

  function editQueueRow(key: SimpleKey | 'variable', idx: number, field: 'name' | 'amount', value: string | number) {
    const rows = [...result[key]]
    rows[idx] = { ...rows[idx], [field]: field === 'amount' ? asNum(value) : String(value) }
    patch(key, rows)
  }

  return (
    <div className="space-y-6">

      {/* Business activity — shown, but deliberately outside the household
          mapping and never copied into it. On a self-employed client the two
          get mixed: a real run put ₪81,234 of customer receipts into "monthly
          income" and made VAT + income tax + the accountant ₪9,464 of a
          ₪10,589 fixed-expense total, which describes the business, not the
          family. */}
      {((result.businessIncome?.length ?? 0) > 0 || (result.businessExpenses?.length ?? 0) > 0) && (
        <div className="rounded-xl border-2 border-line bg-surface2/60 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-txt">🏢 פעילות עסקית — לא חלק ממשק הבית</div>
            <div className="text-xs text-muted-txt">לא יועתק למיפוי · העבר לטאב העסקי</div>
          </div>

          {(['businessIncome', 'businessExpenses'] as const).map(key => {
            const rows = result[key] ?? []
            if (!rows.length) return null
            const total = rows.reduce((s, r) => s + r.amount, 0)
            const label = key === 'businessIncome' ? 'הכנסות העסק' : 'הוצאות העסק'
            const tone  = key === 'businessIncome' ? 'text-income' : 'text-expense'
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-txt">{label}</span>
                  <span className={`text-sm font-bold tabular-nums ${tone}`}>{fmt(total)}<span className="text-xs font-normal text-muted-txt">/חודש</span></span>
                </div>
                {rows.map((r, i) => (
                  <div key={`${key}-${i}`} className="flex items-center gap-2 flex-wrap">
                    <input
                      value={r.name}
                      onChange={e => {
                        const next = [...rows]
                        next[i] = { ...next[i], name: e.target.value }
                        patch(key, next)
                      }}
                      className={`${inputCls} flex-1 min-w-[120px]`}
                      placeholder="שם"
                    />
                    <RowMetaChip confidence={r.confidence} source={r.source} />
                    <input
                      type="number"
                      value={r.amount || ''}
                      onChange={e => {
                        const next = [...rows]
                        next[i] = { ...next[i], amount: asNum(e.target.value) }
                        patch(key, next)
                      }}
                      style={{ direction: 'ltr' }}
                      className={`${inputCls} w-28 text-left tabular-nums shrink-0`}
                      placeholder="₪"
                    />
                    <button
                      onClick={() => patch(key, rows.filter((_, j) => j !== i))}
                      className="size-7 flex items-center justify-center text-muted-txt hover:text-expense rounded shrink-0"
                    >×</button>
                  </div>
                ))}
              </div>
            )
          })}

          <p className="text-[11px] text-muted-txt leading-relaxed">
            מע&quot;מ נגבה מהלקוח ומועבר למדינה — הוא אינו הוצאה של משק הבית. ההכנסה האישית של בעל עסק היא רק מה שהוא מושך לעצמו.
          </p>
        </div>
      )}

      {reviewQueue.length > 0 && (
        <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-3 sm:p-4 space-y-2">
          <div className="text-sm font-semibold text-gold">
            🔎 שורות לבדיקה ({reviewQueue.length})
          </div>
          <p className="text-xs text-muted-txt">
            רק השורות שה‑AI לא היה בטוח בהן. תקן או אשר, והן ייעלמו מכאן. שאר השורות סומנו כאמינות.
          </p>
          <div className="space-y-1.5">
            {reviewQueue.map(({ key, idx, row }) => (
              <div key={`${key}-${idx}`} className="flex items-center gap-2 flex-wrap rounded-lg border border-line bg-surface px-2 py-1.5">
                <input
                  value={row.name}
                  onChange={e => editQueueRow(key, idx, 'name', e.target.value)}
                  className={`${inputCls} flex-1 min-w-[120px]`}
                  placeholder="שם"
                />
                <CategoryPicker
                  value={row.category ?? ''}
                  onChange={cat => setCategory(key, idx, cat)}
                  variant="chip"
                  placeholder="קטגוריה"
                />
                <RowMetaChip confidence={row.confidence} source={row.source} />
                <input
                  type="number"
                  value={row.amount || ''}
                  onChange={e => editQueueRow(key, idx, 'amount', e.target.value)}
                  style={{ direction: 'ltr' }}
                  className={`${inputCls} w-24 text-left tabular-nums shrink-0`}
                  placeholder="₪"
                />
                <button
                  onClick={() => markReviewed(key, idx)}
                  className="shrink-0 rounded-md border border-income/50 bg-income/10 px-2.5 py-1 text-xs font-semibold text-income hover:bg-income/20 transition-colors"
                >
                  ✓ אושר
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile snapshot — credit score + credit cards + checking account,
          identical to the top of the manual mapping tab (point-in-time facts). */}
      <div className="rounded-xl border border-line bg-surface2 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-txt">📊 ציון דירוג אשראי</div>
          <div className="text-xs text-muted-txt mt-0.5">הציון העדכני של הלקוח (לפי דוח נתוני אשראי)</div>
        </div>
        <input
          type="number"
          inputMode="numeric"
          value={creditScore || ''}
          min={0}
          onChange={e => onChange({ creditScore: Math.max(0, parseFloat(e.target.value) || 0) })}
          placeholder="—"
          style={{ direction: 'ltr' }}
          className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-lg font-bold text-gold focus:outline-none focus:border-gold/60 text-left tabular-nums"
        />
      </div>

      <CreditCardsPanel
        cards={creditCardRows}
        onAdd={addCard}
        onUpdate={(id, field, value) => editCard(idxOf(id), field, value)}
        onDelete={id => delRow('creditCards', idxOf(id))}
      />

      <BankAccountsPanel
        accounts={bankAccountRows}
        onAdd={addAccount}
        onUpdate={(id, field, value) => editAccount(idxOf(id), field, value)}
        onDelete={id => delRow('bankAccounts', idxOf(id))}
      />

      {/* One column, not two.
          SectionPanel's row is name + rowExtra + drill + amount + delete on a
          single non-wrapping line, and the lab adds two more chips to it (the
          category picker and the source). The name <input> will not shrink below
          its intrinsic ~177px — that would need min-w-0 on SectionPanel, which
          the real mapping tab shares — so the row needs roughly 620px. A
          two-column layout gave it ~530px, and the overflow spilled outside the
          card border: visibly crooked, cut-off rows.
          Narrowing the chips instead would have made them unreadable, and they
          are the point: the category is editable and the source is how the
          advisor checks a number. Full width costs vertical scrolling on a
          screen that is reviewed once per client. */}
      {/* Said once, up front: the rows are monthly averages and the פירוט lists
          the whole window. Without this the advisor opens a ₪1,547 row, counts
          ₪4,600 of charges, and reasonably concludes the mapping is broken. */}
      {months > 1 && (
        <div className="rounded-lg border border-line bg-surface2/60 px-3 py-2 text-xs text-muted-txt">
          השורות הן <strong className="text-txt">ממוצע חודשי</strong>. הפירוט מתחתן מציג את העסקאות של כל {months} החודשים, ולכן סכומו גדול פי {months} בערך.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">

        {/* שורה 1: הכנסות | קבועות */}
        <SectionPanel
          title="הכנסות חודשיות"
          icon="💰"
          rows={simpleRows('income')}
          totalLabel="סה&quot;כ הכנסות"
          totalColor="text-income"
          colName="מקור הכנסה"
          rowExtra={chipFor('income')}
          resolveTxns={resolveIncomeTxns}
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
          resolveTxns={resolveTxnsFor('fixed')}
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
          resolveTxns={resolveTxnsFor('sub')}
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
          resolveTxns={resolveTxnsFor('ins')}
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
                          {/* Picking a different category moves the row out of
                              משתנות and into the section that category belongs to. */}
                          <CategoryPicker
                            value={r.category ?? ''}
                            onChange={cat => setCategory('variable', r._idx, cat)}
                            variant="chip"
                            placeholder="קטגוריה"
                            className="max-w-[112px]"
                          />
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
