'use client'

import { toast } from 'sonner'
import { useMappingStore } from '@/stores/mappingStore'
import { useCreditStore } from '@/stores/creditStore'
import { SectionPanel } from '@/components/mapping/SectionPanel'
import { VariablePanel } from '@/components/mapping/VariablePanel'
import { DebtPanel } from '@/components/mapping/DebtPanel'
import { InstallmentPanel } from '@/components/mapping/InstallmentPanel'
import { SavingPanel } from '@/components/mapping/SavingPanel'
import { CashflowSummary } from '@/components/mapping/CashflowSummary'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function MappingPage() {
  const store = useMappingStore()
  const { transactions } = useCreditStore()

  function handleImport() {
    if (!transactions.length) {
      toast.error('אין עסקאות בטאב האשראי — יש להעלות קבצים קודם')
      return
    }
    store.importFromCredit(transactions, store.varMonths)
    const count = transactions.filter(t => !t.isRefund).length
    toast.success(`יובאו ${count} עסקאות לקבועות / משתנות / מנויים / ביטוחים / שנתיות`)
  }

  const totalAnnualMo = Math.round(store.annual.reduce((s, r) => s + r.annualAmount, 0) / 12)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🗂️ מיפוי ידני</h1>
        <p className="text-muted-txt text-sm">הגדר הכנסות והוצאות חודשיות — הבסיס לתכנון התקציב</p>
      </div>

      {/* 2-column grid for the first 6 sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 1. Income */}
        <SectionPanel
          title="הכנסות חודשיות"
          icon="💰"
          rows={store.income}
          totalLabel="סה&quot;כ הכנסות"
          totalColor="text-green-400"
          onAdd={() => store.addRow('income')}
          onUpdate={(id, field, value) => store.updateRow('income', id, field, value)}
          onDelete={id => store.deleteRow('income', id)}
          colName="מקור הכנסה"
        />

        {/* 2. Fixed */}
        <SectionPanel
          title="הוצאות קבועות"
          icon="📌"
          rows={store.fixed}
          totalLabel="סה&quot;כ קבועות"
          onAdd={() => store.addRow('fixed')}
          onUpdate={(id, field, value) => store.updateRow('fixed', id, field, value)}
          onDelete={id => store.deleteRow('fixed', id)}
          colName="סוג הוצאה"
          colAmt="סכום חודשי ₪"
          creditTransactions={transactions}
        />

        {/* 3. Annual */}
        <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-txt">📅 הוצאות שנתיות</h2>
            </div>
            <span className="text-xs text-muted-txt">
              שנתי: <span className="font-bold text-expense">{fmt(store.annual.reduce((s,r) => s+r.annualAmount, 0))}</span>
              <span className="mx-2">|</span>
              לחודש: <span className="font-bold text-gold">{fmt(totalAnnualMo)}</span>
            </span>
          </div>
          <div className="grid grid-cols-[1fr_5rem_3.5rem_1.5rem] sm:grid-cols-[1fr_6rem_5rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
            <span>סוג הוצאה</span>
            <span className="text-left">סכום שנתי ₪</span>
            <span className="text-center">לחודש</span>
            <span />
          </div>
          <div className="space-y-1.5">
            {store.annual.map(row => (
              <div key={row.id} className="grid grid-cols-[1fr_5rem_3.5rem_1.5rem] sm:grid-cols-[1fr_6rem_5rem_1.5rem] gap-2 items-center group">
                <input
                  value={row.name}
                  onChange={e => store.updateAnnualRow(row.id, 'name', e.target.value)}
                  placeholder="שם ההוצאה"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
                <input
                  type="number"
                  value={row.annualAmount || ''}
                  onChange={e => store.updateAnnualRow(row.id, 'annualAmount', parseFloat(e.target.value) || 0)}
                  placeholder="₪"
                  min={0}
                  style={{ direction: 'ltr' }}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                />
                <span className="text-xs text-center px-1 py-1.5 rounded border border-line bg-surface text-muted-txt tabular-nums">
                  {fmt(Math.round(row.annualAmount / 12))}
                </span>
                <button
                  onClick={() => store.deleteAnnualRow(row.id)}
                  className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm"
                >×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-line">
            <button onClick={store.addAnnualRow} className="text-xs text-muted-txt hover:text-gold transition-colors">
              + הוסף שורה
            </button>
            <span className="text-xs text-muted-txt">
              סה&quot;כ שנתי: <span className="font-medium text-expense">{fmt(store.annual.reduce((s,r) => s+r.annualAmount, 0))}</span>
              <span className="mx-1">|</span>
              לחודש: <span className="font-medium text-gold">{fmt(totalAnnualMo)}</span>
            </span>
          </div>
        </div>

        {/* 4. Subscriptions */}
        <SectionPanel
          title="מינויים ומנויים"
          icon="🔄"
          rows={store.sub}
          totalLabel="סה&quot;כ מנויים"
          onAdd={() => store.addRow('sub')}
          onUpdate={(id, field, value) => store.updateRow('sub', id, field, value)}
          onDelete={id => store.deleteRow('sub', id)}
          colName="שם המנוי"
          creditTransactions={transactions}
        />

        {/* 5. Insurance */}
        <SectionPanel
          title="ביטוחים"
          icon="🛡️"
          rows={store.ins}
          totalLabel="סה&quot;כ ביטוחים"
          onAdd={() => store.addRow('ins')}
          onUpdate={(id, field, value) => store.updateRow('ins', id, field, value)}
          onDelete={id => store.deleteRow('ins', id)}
          colName="סוג הביטוח"
          colAmt="פרמיה חודשית ₪"
          creditTransactions={transactions}
        />

        {/* 6. Variable */}
        <VariablePanel
          rows={store.variable}
          varMonths={store.varMonths}
          creditImported={store.creditImported}
          hasCredit={transactions.length > 0}
          creditTransactions={transactions}
          onAdd={() => store.addVarRow()}
          onUpdate={(id, field, value) => store.updateVarRow(id, field, value)}
          onDelete={id => store.deleteVarRow(id)}
          onMonthsChange={store.setVarMonths}
          onImport={handleImport}
        />

      </div>

      {/* Full-width sections */}
      <DebtPanel
        debts={store.debts}
        onAdd={store.addDebtRow}
        onUpdate={(id, field, value) => store.updateDebtRow(id, field, value)}
        onDelete={store.deleteDebtRow}
      />

      <InstallmentPanel
        installments={store.installments}
        onAdd={store.addInstallmentRow}
        onUpdate={(id, field, value) => store.updateInstallmentRow(id, field, value)}
        onDelete={store.deleteInstallmentRow}
      />

      <SavingPanel
        savings={store.savings}
        onAdd={store.addSavingRow}
        onUpdate={(id, field, value) => store.updateSavingRow(id, field, value)}
        onDelete={store.deleteSavingRow}
      />

      {/* Live cashflow summary */}
      <CashflowSummary
        income={store.income}
        fixed={store.fixed}
        sub={store.sub}
        ins={store.ins}
        variable={store.variable}
        annual={store.annual}
        debts={store.debts}
        installments={store.installments}
        savings={store.savings}
        varMonths={store.varMonths}
      />
    </div>
  )
}
