'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useBusinessStore, type BizSection, type BizRow, type BusinessType } from '@/stores/businessStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { MONTHS_LIST } from '@/lib/constants'
import {
  calcIncomeTaxMonthly, calcBituachLeumiMonthly, calcCompanyTaxMonthly, calcVat,
} from '@/lib/businessTax'

const SALARY_LABEL = 'משכורת מהעסק'

function fmt(n: number) {
  const sign = n < 0 ? '-' : ''
  return sign + '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')
}

const TYPES: { id: BusinessType; label: string; hint: string }[] = [
  { id: 'osek_murshe', label: 'עוסק מורשה', hint: 'מע"מ + מס לפי מדרגות' },
  { id: 'osek_patur',  label: 'עוסק פטור',  hint: 'ללא מע"מ' },
  { id: 'company',     label: 'חברה בע"מ',  hint: 'מס חברות 23%' },
]

// ── module-level sub-components (stable identity → no focus loss) ──────────────

function SectionPanel({
  title, icon, rows, total, color, colName, showVat,
  onAdd, onUpdate, onDelete,
}: {
  title: string; icon: string; rows: BizRow[]; total: number; color: string; colName: string; showVat: boolean
  onAdd: () => void
  onUpdate: (id: string, field: 'name' | 'amount' | 'vatDeductible', value: string | number | boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">{icon} {title}</h2>
        <span className={`text-sm font-bold tabular-nums ${color}`}>{fmt(total)}<span className="text-xs font-normal text-muted-txt">/חודש</span></span>
      </div>

      {/* column hints (desktop) */}
      <div className="hidden sm:flex items-center gap-2 px-1 text-xs text-muted-txt font-medium">
        <span className="flex-1">{colName}</span>
        <span className="w-28 text-end">₪ לחודש (לפני מע&quot;מ)</span>
        {showVat && <span className="w-14 text-center">מע&quot;מ</span>}
        <span className="w-9" />
      </div>

      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.id} className="group flex items-center gap-2">
            <input
              value={row.name}
              onChange={e => onUpdate(row.id, 'name', e.target.value)}
              placeholder={colName}
              className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            <input
              type="number" inputMode="decimal" value={row.amount || ''} min={0}
              onChange={e => onUpdate(row.id, 'amount', parseFloat(e.target.value) || 0)}
              placeholder="₪" style={{ direction: 'ltr' }}
              className="w-24 sm:w-28 rounded-lg border border-line bg-surface px-2 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
            {showVat && (
              <label className="w-14 py-3 min-h-[44px] flex items-center justify-center gap-1 text-[10px] text-muted-txt cursor-pointer select-none" title="מזכה במע&quot;מ תשומות">
                <input
                  type="checkbox" checked={row.vatDeductible}
                  onChange={e => onUpdate(row.id, 'vatDeductible', e.target.checked)}
                  className="accent-gold size-4"
                />
                מע&quot;מ
              </label>
            )}
            <button
              onClick={() => onDelete(row.id)}
              aria-label="מחק שורה"
              className="shrink-0 w-9 h-9 flex items-center justify-center text-muted-txt hover:text-expense active:text-expense transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-base leading-none"
            >×</button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted-txt py-2">אין שורות</p>}
      </div>

      <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors py-3 min-h-[44px] inline-flex items-center">+ הוסף שורה</button>
    </div>
  )
}

function TaxLine({ label, hint, value, overridden, onOverride, onReset }: {
  label: string; hint?: string; value: number; overridden: boolean
  onOverride: (v: number) => void; onReset: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-b border-line/50 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-txt">{label}</div>
        {hint && <div className="text-[10px] text-muted-txt leading-tight">{hint}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted-txt">−₪</span>
        <input
          type="number" inputMode="numeric" value={Math.round(value) || ''} min={0}
          onChange={e => onOverride(parseFloat(e.target.value) || 0)}
          style={{ direction: 'ltr' }}
          className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-semibold text-expense focus:outline-none focus:border-gold/60 text-left tabular-nums"
        />
        <button
          onClick={onReset}
          title={overridden ? 'אפס לחישוב אוטומטי' : 'מחושב אוטומטית'}
          className={`px-2 py-2 min-h-[44px] text-base leading-none transition-colors ${overridden ? 'text-gold hover:text-gold-light' : 'text-muted-txt/40 cursor-default'}`}
          disabled={!overridden}
        >↺</button>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function BusinessPage() {
  const store = useBusinessStore()
  const [salaryMonth, setSalaryMonth] = useState('')

  const isPatur = store.businessType === 'osek_patur'
  const isCompany = store.businessType === 'company'

  const totals = useMemo(() => {
    const revenue = store.revenue.reduce((s, r) => s + (r.amount || 0), 0)
    const cogs = store.cogs.reduce((s, r) => s + (r.amount || 0), 0)
    const opex = store.opex.reduce((s, r) => s + (r.amount || 0), 0)
    const deductible = [...store.cogs, ...store.opex]
      .filter(r => r.vatDeductible)
      .reduce((s, r) => s + (r.amount || 0), 0)
    return { revenue, cogs, opex, deductible }
  }, [store.revenue, store.cogs, store.opex])

  const grossProfit = totals.revenue - totals.cogs
  const preTaxProfit = grossProfit - totals.opex

  // ── VAT (hidden for עוסק פטור) ──
  const vatCalc = calcVat(totals.revenue, totals.deductible, store.vatRate)
  const vatPayable = store.vatOverride ?? vatCalc.payable

  // ── taxes ──
  const incomeTaxAuto = calcIncomeTaxMonthly(preTaxProfit, store.taxPoints)
  const incomeTax = isCompany ? 0 : (store.incomeTaxOverride ?? incomeTaxAuto)

  const blAuto = calcBituachLeumiMonthly(preTaxProfit)
  const bituachLeumi = isCompany ? 0 : (store.bituachLeumiOverride ?? blAuto)

  const companyTaxAuto = calcCompanyTaxMonthly(preTaxProfit)
  const companyTax = isCompany ? (store.companyTaxOverride ?? companyTaxAuto) : 0

  const totalTax = incomeTax + bituachLeumi + companyTax
  const netProfit = preTaxProfit - totalTax
  const leftInBusiness = netProfit - store.ownerSalary

  function pushSalaryToMonth() {
    if (!salaryMonth) { toast.error('בחר חודש יעד'); return }
    const ms = useMonthlyStore.getState()
    ms.initMonth(salaryMonth)
    const income = useMonthlyStore.getState().months[salaryMonth].income
    const existing = income.find(r => r.name === SALARY_LABEL)
    if (existing) {
      ms.updateRow(salaryMonth, 'income', existing.id, 'plan', Math.round(store.ownerSalary))
    } else {
      ms.addRow(salaryMonth, 'income', SALARY_LABEL)
      const added = useMonthlyStore.getState().months[salaryMonth].income.find(r => r.name === SALARY_LABEL)
      if (added) ms.updateRow(salaryMonth, 'income', added.id, 'plan', Math.round(store.ownerSalary))
    }
    const monthName = MONTHS_LIST.find(m => m.id === salaryMonth)?.name
    toast.success(`✅ ${fmt(store.ownerSalary)} נשלחו כהכנסה לתקציב ${monthName}`)
  }

  const bind = (section: BizSection) => ({
    onAdd: () => store.addRow(section),
    onUpdate: (id: string, field: 'name' | 'amount' | 'vatDeductible', value: string | number | boolean) =>
      store.updateRow(section, id, field, value),
    onDelete: (id: string) => store.deleteRow(section, id),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">🏢 תקציב עסקי</h1>
          <p className="hidden sm:block text-muted-txt text-xs sm:text-sm leading-relaxed">
            כלי לעצמאים — הפרדה בין תקציב העסק לתקציב הבית. כל הסכומים חודשיים ולפני מע&quot;מ. מס ומע&quot;מ מחושבים אוטומטית, וניתן לדרוס ידנית.
          </p>
        </div>

        {/* Business type selector */}
        <div>
          <div className="text-xs font-semibold text-muted-txt mb-1.5">סוג העסק</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {TYPES.map(t => {
              const active = store.businessType === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => store.setBusinessType(t.id)}
                  className={[
                    'text-start rounded-xl border p-3 transition-all',
                    active ? 'border-gold bg-gold/15 ring-2 ring-gold/30' : 'border-line bg-surface hover:bg-surface3',
                  ].join(' ')}
                >
                  <div className={`text-sm font-bold ${active ? 'text-gold' : 'text-txt'}`}>{t.label}</div>
                  <div className="text-[11px] text-muted-txt mt-0.5">{t.hint}</div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Revenue */}
      <SectionPanel
        title="מחזור / הכנסות" icon="💰" rows={store.revenue} total={totals.revenue}
        color="text-income" colName="מקור הכנסה" showVat={false} {...bind('revenue')}
      />

      {/* COGS */}
      <SectionPanel
        title="הוצאות גולמיות (עלות המכר)" icon="📦" rows={store.cogs} total={totals.cogs}
        color="text-expense" colName="סוג הוצאה" showVat={!isPatur} {...bind('cogs')}
      />

      {/* Gross profit */}
      <div className="rounded-xl border border-line bg-surface2 p-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-txt">רווח גולמי <span className="text-[11px] font-normal text-muted-txt">(מחזור − גולמיות)</span></span>
        <span className={`text-xl font-black tabular-nums ${grossProfit >= 0 ? 'text-txt' : 'text-expense'}`}>{fmt(grossProfit)}</span>
      </div>

      {/* OpEx */}
      <SectionPanel
        title="הוצאות תפעוליות" icon="🧾" rows={store.opex} total={totals.opex}
        color="text-expense" colName="סוג הוצאה" showVat={!isPatur} {...bind('opex')}
      />

      {/* Tax config */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-txt text-sm">⚙️ הגדרות מס</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!isCompany && (
            <div className="space-y-1">
              <label className="text-xs text-muted-txt">נקודות זיכוי</label>
              <input
                type="number" inputMode="decimal" value={store.taxPoints || ''} min={0} step={0.25}
                onChange={e => store.setTaxPoints(parseFloat(e.target.value) || 0)}
                style={{ direction: 'ltr' }}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
              />
            </div>
          )}
          {!isPatur && (
            <div className="space-y-1">
              <label className="text-xs text-muted-txt">שיעור מע"מ %</label>
              <input
                type="number" inputMode="decimal" value={Math.round(store.vatRate * 100) || ''} min={0} step={1}
                onChange={e => store.setVatRate((parseFloat(e.target.value) || 0) / 100)}
                style={{ direction: 'ltr' }}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
              />
            </div>
          )}
        </div>
      </div>

      {/* P&L results */}
      <div className="rounded-2xl border-2 border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-4 sm:p-6 space-y-1">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-line/50">
          <span className="text-sm font-semibold text-txt">רווח לפני מס <span className="text-[11px] font-normal text-muted-txt">(ההכנסה החייבת)</span></span>
          <span className={`text-lg font-black tabular-nums ${preTaxProfit >= 0 ? 'text-gold' : 'text-expense'}`}>{fmt(preTaxProfit)}</span>
        </div>

        {isCompany ? (
          <TaxLine
            label="מס חברות (23%)"
            value={companyTax}
            overridden={store.companyTaxOverride !== null}
            onOverride={store.setCompanyTaxOverride}
            onReset={() => store.setCompanyTaxOverride(null)}
          />
        ) : (
          <>
            <TaxLine
              label="מס הכנסה"
              hint="מדרגות מס − נקודות זיכוי"
              value={incomeTax}
              overridden={store.incomeTaxOverride !== null}
              onOverride={store.setIncomeTaxOverride}
              onReset={() => store.setIncomeTaxOverride(null)}
            />
            <TaxLine
              label="ביטוח לאומי + מס בריאות"
              hint="עצמאי — מדורג"
              value={bituachLeumi}
              overridden={store.bituachLeumiOverride !== null}
              onOverride={store.setBituachLeumiOverride}
              onReset={() => store.setBituachLeumiOverride(null)}
            />
          </>
        )}

        <div className="flex items-center justify-between gap-2 pt-3">
          <span className="text-sm font-bold text-txt">רווח נקי</span>
          <span className={`text-2xl font-black tabular-nums ${netProfit >= 0 ? 'text-income' : 'text-expense'}`}>{fmt(netProfit)}</span>
        </div>
      </div>

      {/* VAT box — hidden for עוסק פטור */}
      {!isPatur ? (
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2.5">
          <h2 className="font-semibold text-txt text-sm">🧮 מע&quot;מ <span className="text-[11px] font-normal text-muted-txt">(מעבר — לא חלק מרווחי העסק)</span></h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface p-2.5">
              <div className="text-[10px] text-muted-txt">עסקאות</div>
              <div className="text-sm font-bold text-txt tabular-nums">{fmt(vatCalc.output)}</div>
            </div>
            <div className="rounded-lg bg-surface p-2.5">
              <div className="text-[10px] text-muted-txt">תשומות</div>
              <div className="text-sm font-bold text-txt tabular-nums">{fmt(vatCalc.input)}</div>
            </div>
            <div className="col-span-full sm:col-span-1 rounded-lg border border-gold/30 bg-gold/5 p-2.5">
              <div className="text-[10px] text-muted-txt">לתשלום</div>
              <div className={`text-sm font-black tabular-nums ${vatPayable >= 0 ? 'text-gold' : 'text-income'}`}>{fmt(vatPayable)}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-txt">דריסה ידנית של מע&quot;מ לתשלום:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-txt">₪</span>
              <input
                type="number" inputMode="numeric" value={store.vatOverride ?? ''} placeholder={String(Math.round(vatCalc.payable))}
                onChange={e => store.setVatOverride(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                style={{ direction: 'ltr' }}
                className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-gold focus:outline-none focus:border-gold/60 text-left tabular-nums"
              />
              {store.vatOverride !== null && (
                <button onClick={() => store.setVatOverride(null)} className="px-2 py-2 text-base leading-none text-gold hover:text-gold-light" title="אפס">↺</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface2 px-4 py-3 text-xs text-muted-txt leading-relaxed">
          🧮 עוסק פטור אינו גובה מע&quot;מ ואינו מקזז תשומות — ההוצאות שהוזנו כוללות את המע&quot;מ ששולם בפועל.
        </div>
      )}

      {/* Owner salary → household */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-txt text-sm">👤 משכורת אישית (משיכה לבית)</h2>
          <div className="flex items-center gap-1.5">
            <span className="text-base">₪</span>
            <input
              type="number" inputMode="numeric" value={store.ownerSalary || ''} min={0}
              onChange={e => store.setOwnerSalary(parseFloat(e.target.value) || 0)}
              placeholder="0" style={{ direction: 'ltr' }}
              className="w-28 sm:w-32 rounded-lg border border-line bg-surface px-3 py-2 text-base font-bold text-gold focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
          </div>
        </div>

        {!isCompany && (
          <p className="text-[11px] text-muted-txt leading-relaxed">
            לעוסק מורשה/פטור המשכורת היא <strong className="text-txt">משיכת בעלים</strong> — לא הוצאה מוכרת, ולכן כל הרווח חייב במס.
          </p>
        )}
        {isCompany && (
          <p className="text-[11px] text-muted-txt leading-relaxed">
            מודל חברה מפושט (בלי שכבת דיבידנד). בפועל משכורת בעלים היא הוצאה מוכרת שמקטינה את הרווח החייב — דרוס ידנית את המס אם צריך דיוק.
          </p>
        )}

        {/* Send to monthly */}
        <div className="rounded-lg border border-line bg-surface p-3 space-y-2.5">
          <div className="text-xs font-semibold text-txt">📤 שלח כהכנסה לתקציב החודשי</div>
          <div className="flex flex-wrap gap-1.5">
            {MONTHS_LIST.map(m => (
              <button
                key={m.id}
                onClick={() => setSalaryMonth(m.id)}
                className={`px-3 py-2.5 min-h-[44px] flex items-center rounded-lg text-xs font-medium border transition-colors ${
                  salaryMonth === m.id ? 'bg-gold/20 border-gold/60 text-gold' : 'bg-surface2 border-line text-muted-txt hover:text-txt hover:border-gold/40'
                }`}
              >{m.name}</button>
            ))}
          </div>
          <button
            onClick={pushSalaryToMonth}
            disabled={!salaryMonth || store.ownerSalary <= 0}
            className="w-full py-2.5 rounded-lg bg-gold/20 border border-gold/40 text-gold font-bold text-sm tabular-nums hover:bg-gold/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            📤 שלח {fmt(store.ownerSalary)} ל{MONTHS_LIST.find(m => m.id === salaryMonth)?.name ?? 'חודש שתבחר'}
          </button>
          <p className="text-[10px] text-muted-txt text-center">
            מעדכן שורת הכנסה &quot;{SALARY_LABEL}&quot; בעמודת התכנון. אפשר לעבור ל<Link href="/app/monthly/jan" className="text-gold hover:underline">טאב החודשי</Link>.
          </p>
        </div>
      </div>

      {/* Cash flow summary — bottom */}
      <div className="rounded-2xl border-2 border-line bg-surface2 p-4 sm:p-6 space-y-2">
        <h2 className="font-semibold text-txt mb-1">📊 תזרים העסק</h2>
        {[
          { label: 'מחזור', val: totals.revenue, sign: 1 },
          { label: 'הוצאות (גולמיות + תפעוליות)', val: -(totals.cogs + totals.opex), sign: -1 },
          ...(isCompany
            ? [{ label: 'מס חברות', val: -companyTax, sign: -1 }]
            : [
                { label: 'מס הכנסה', val: -incomeTax, sign: -1 },
                { label: 'ביטוח לאומי + מס בריאות', val: -bituachLeumi, sign: -1 },
              ]),
        ].map(({ label, val }) => (
          <div key={label} className="flex items-center justify-between text-sm py-0.5">
            <span className="text-muted-txt">{label}</span>
            <span className={`tabular-nums ${val >= 0 ? 'text-income' : 'text-expense'}`}>{fmt(val)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-line">
          <span className="text-sm font-bold text-txt">רווח נקי</span>
          <span className={`text-base font-black tabular-nums ${netProfit >= 0 ? 'text-income' : 'text-expense'}`}>{fmt(netProfit)}</span>
        </div>
        <div className="flex items-center justify-between text-sm py-0.5">
          <span className="text-muted-txt">משכורת אישית (משיכה לבית)</span>
          <span className="tabular-nums text-expense">{fmt(-store.ownerSalary)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 mt-1 border-t-2 border-gold/30">
          <span className="text-sm font-bold text-gold">יתרת מזומן שנשארת בעסק</span>
          <span className={`text-xl font-black tabular-nums ${leftInBusiness >= 0 ? 'text-gold' : 'text-expense'}`}>{fmt(leftInBusiness)}</span>
        </div>
      </div>

      <p className="text-[11px] text-muted-txt text-center px-4 leading-relaxed">
        החישובים הם הערכה לצרכי תכנון בלבד ואינם מהווים ייעוץ מס. שיעורי המס נכונים לשנת 2025 וניתנים לדריסה ידנית. להחלטות מהותיות יש להתייעץ עם רואה חשבון.
      </p>
    </div>
  )
}
