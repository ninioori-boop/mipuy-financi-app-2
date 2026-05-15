'use client'

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer'
import type { AnnualRow, AnnualDebtRow } from '@/stores/annualStore'
import type { MonthData } from '@/stores/monthlyStore'
import { MONTH_IDS } from '@/lib/constants'

Font.register({
  family: 'Heebo',
  fonts: [
    { src: '/fonts/Heebo-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Heebo-Bold.ttf',    fontWeight: 'bold' },
  ],
})

// react-pdf can't shape emoji glyphs with a Hebrew text font; strip them
Font.registerHyphenationCallback(word => [word])

const MONTH_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']

export interface AnnualPdfInput {
  year: number
  income: AnnualRow[]
  fixed: AnnualRow[]
  variable: AnnualRow[]
  sub: AnnualRow[]
  savings: AnnualRow[]
  debt: AnnualDebtRow[]
  months: Record<string, MonthData | undefined>
}

function fmt(n: number) {
  return '₪' + Math.round(n || 0).toLocaleString('he-IL')
}

const C = {
  gold:   '#A88844',
  dark:   '#1A1A1A',
  line:   '#D8CFB7',
  txt:    '#1A1A1A',
  muted:  '#6B6357',
  income: '#138E4F',
  exp:    '#B53C3C',
  bg:     '#FFFFFF',
  bgAlt:  '#F8F3E7',
}

const s = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: C.bg,
    padding: 28,
    fontFamily: 'Heebo',
    fontSize: 9,
    color: C.txt,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: C.gold,
    paddingBottom: 8,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 10, color: C.gold, fontWeight: 'bold' },
  title: { fontSize: 18, fontWeight: 'bold', color: C.gold, marginTop: 2, textAlign: 'right' },
  subtitle: { fontSize: 9, color: C.muted, textAlign: 'right', marginTop: 2 },
  date: { fontSize: 8, color: C.muted },

  // KPI grid
  kpiRow: { flexDirection: 'row-reverse', gap: 6, marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8, backgroundColor: C.bgAlt },
  kpiLabel: { fontSize: 8, color: C.muted, textAlign: 'right' },
  kpiValue: { fontSize: 13, fontWeight: 'bold', color: C.gold, textAlign: 'right', marginTop: 3 },
  kpiSub: { fontSize: 7, color: C.muted, textAlign: 'right', marginTop: 2 },

  // Section
  sectionTitle: { fontSize: 11, fontWeight: 'bold', color: C.gold, marginBottom: 4, textAlign: 'right' },

  // Table
  table: { borderWidth: 1, borderColor: C.line, borderRadius: 3, marginBottom: 10 },
  tHeadRow: { flexDirection: 'row-reverse', backgroundColor: C.bgAlt, borderBottomWidth: 1, borderBottomColor: C.line },
  tRow: { flexDirection: 'row-reverse', borderBottomWidth: 0.5, borderBottomColor: C.line },
  tRowAlt: { flexDirection: 'row-reverse', backgroundColor: '#FAFAFA', borderBottomWidth: 0.5, borderBottomColor: C.line },
  tFootRow: { flexDirection: 'row-reverse', backgroundColor: C.bgAlt, borderTopWidth: 1, borderTopColor: C.gold },
  th: { padding: 4, fontSize: 8, fontWeight: 'bold', color: C.muted, textAlign: 'right' },
  td: { padding: 4, fontSize: 8.5, textAlign: 'right' },
  tdNum: { padding: 4, fontSize: 8.5, textAlign: 'left' },

  // Section grid (two columns)
  twoCol: { flexDirection: 'row-reverse', gap: 10, marginBottom: 6 },
  half: { flex: 1 },

  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    fontSize: 7,
    color: C.muted,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 4,
  },
})

function SectionTable({ title, rows, valueLabel = 'שנתי' }: {
  title: string
  rows: { name: string; annual: number }[]
  valueLabel?: string
}) {
  const total = rows.reduce((acc, r) => acc + (r.annual || 0), 0)
  const visible = rows.filter(r => (r.annual || 0) > 0 || (r.name || '').trim().length > 0)
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.table}>
        <View style={s.tHeadRow}>
          <Text style={[s.th, { flex: 2 }]}>פריט</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'left' }]}>{valueLabel} ₪</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'left' }]}>חודשי ₪</Text>
        </View>
        {visible.length === 0 && (
          <View style={s.tRow}>
            <Text style={[s.td, { flex: 4, color: C.muted, textAlign: 'center' }]}>—</Text>
          </View>
        )}
        {visible.map((r, i) => (
          <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
            <Text style={[s.td, { flex: 2 }]}>{r.name || '—'}</Text>
            <Text style={[s.tdNum, { flex: 1 }]}>{fmt(r.annual || 0)}</Text>
            <Text style={[s.tdNum, { flex: 1, color: C.muted }]}>{(r.annual || 0) > 0 ? fmt((r.annual || 0) / 12) : '—'}</Text>
          </View>
        ))}
        <View style={s.tFootRow}>
          <Text style={[s.td, { flex: 2, fontWeight: 'bold' }]}>סה"כ</Text>
          <Text style={[s.tdNum, { flex: 1, fontWeight: 'bold', color: C.gold }]}>{fmt(total)}</Text>
          <Text style={[s.tdNum, { flex: 1, fontWeight: 'bold', color: C.gold }]}>{fmt(total / 12)}</Text>
        </View>
      </View>
    </View>
  )
}

function DebtTable({ rows }: { rows: AnnualDebtRow[] }) {
  const totalAnnual = rows.reduce((s, r) => s + (r.annual || 0), 0)
  const totalBalance = rows.reduce((s, r) => s + (r.balance || 0), 0)
  const visible = rows.filter(r => (r.annual || 0) > 0 || (r.balance || 0) > 0 || (r.name || '').trim().length > 0)
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={s.sectionTitle}>הלוואות וחובות</Text>
      <View style={s.table}>
        <View style={s.tHeadRow}>
          <Text style={[s.th, { flex: 2 }]}>שם הלוואה</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'left' }]}>שנתי ₪</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'left' }]}>חודשי ₪</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'left' }]}>יתרה ₪</Text>
        </View>
        {visible.length === 0 && (
          <View style={s.tRow}>
            <Text style={[s.td, { flex: 5, color: C.muted, textAlign: 'center' }]}>—</Text>
          </View>
        )}
        {visible.map((r, i) => (
          <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
            <Text style={[s.td, { flex: 2 }]}>{r.name || '—'}</Text>
            <Text style={[s.tdNum, { flex: 1 }]}>{fmt(r.annual || 0)}</Text>
            <Text style={[s.tdNum, { flex: 1, color: C.muted }]}>{(r.annual || 0) > 0 ? fmt((r.annual || 0) / 12) : '—'}</Text>
            <Text style={[s.tdNum, { flex: 1 }]}>{(r.balance || 0) > 0 ? fmt(r.balance) : '—'}</Text>
          </View>
        ))}
        <View style={s.tFootRow}>
          <Text style={[s.td, { flex: 2, fontWeight: 'bold' }]}>סה"כ</Text>
          <Text style={[s.tdNum, { flex: 1, fontWeight: 'bold', color: C.gold }]}>{fmt(totalAnnual)}</Text>
          <Text style={[s.tdNum, { flex: 1, fontWeight: 'bold', color: C.gold }]}>{fmt(totalAnnual / 12)}</Text>
          <Text style={[s.tdNum, { flex: 1, fontWeight: 'bold', color: C.gold }]}>{fmt(totalBalance)}</Text>
        </View>
      </View>
    </View>
  )
}

function AnnualPdfDocument({ input }: { input: AnnualPdfInput }) {
  const pIncome   = input.income.reduce((s, r) => s + (r.annual || 0), 0)
  const pFixed    = input.fixed.reduce((s, r) => s + (r.annual || 0), 0)
  const pVariable = input.variable.reduce((s, r) => s + (r.annual || 0), 0)
  const pSub      = input.sub.reduce((s, r) => s + (r.annual || 0), 0)
  const pSavings  = input.savings.reduce((s, r) => s + (r.annual || 0), 0)
  const pDebt     = input.debt.reduce((s, r) => s + (r.annual || 0), 0)
  const pExp = pFixed + pVariable + pSub + pDebt + pSavings
  const pCF  = pIncome - pExp

  const acts = MONTH_IDS.map(mid => {
    const d = input.months[mid]
    if (!d) return null
    return {
      income: d.income.reduce((s, r) => s + (r.actual || 0), 0),
      fixed: d.fixed.reduce((s, r) => s + (r.actual || 0), 0),
      variable: d.variable.reduce((s, r) => s + (r.actual || 0), 0),
      sub: d.sub.reduce((s, r) => s + (r.actual || 0), 0) + d.ins.reduce((s, r) => s + (r.actual || 0), 0),
      debt: d.debts.reduce((s, r) => s + (r.monthly || 0), 0) + d.installments.reduce((s, r) => s + (r.monthly || 0), 0),
      savings: d.savings.reduce((s, r) => s + (r.monthly || 0), 0),
    }
  })
  const aIncome = acts.reduce((s, m) => s + (m?.income ?? 0), 0)
  const aFixed = acts.reduce((s, m) => s + (m?.fixed ?? 0), 0)
  const aVariable = acts.reduce((s, m) => s + (m?.variable ?? 0), 0)
  const aSub = acts.reduce((s, m) => s + (m?.sub ?? 0), 0)
  const aDebt = acts.reduce((s, m) => s + (m?.debt ?? 0), 0)
  const aSavings = acts.reduce((s, m) => s + (m?.savings ?? 0), 0)
  const aExp = aFixed + aVariable + aSub + aDebt + aSavings
  const aCF = aIncome - aExp
  const activeMonths = acts.filter(Boolean).length

  const today = new Date().toLocaleDateString('he-IL')

  return (
    <Document
      title={`תכנון שנתי ${input.year}`}
      author="The Home Economist"
    >
      {/* Page 1: Cover + sections */}
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerRow}>
            <Text style={s.brand}>The Home Economist</Text>
            <Text style={s.date}>הופק: {today}</Text>
          </View>
          <Text style={s.title}>תכנון שנתי {input.year}</Text>
          <Text style={s.subtitle}>תקציב שנתי מול ביצוע YTD</Text>
        </View>

        {/* KPIs */}
        <View style={s.kpiRow}>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>הכנסות שנתיות</Text>
            <Text style={[s.kpiValue, { color: C.income }]}>{fmt(pIncome)}</Text>
            <Text style={s.kpiSub}>חודשי: {fmt(pIncome / 12)}</Text>
            {activeMonths > 0 && <Text style={s.kpiSub}>ביצוע: {fmt(aIncome)}</Text>}
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>הוצאות שנתיות</Text>
            <Text style={[s.kpiValue, { color: C.exp }]}>{fmt(pExp)}</Text>
            <Text style={s.kpiSub}>חודשי: {fmt(pExp / 12)}</Text>
            {activeMonths > 0 && <Text style={s.kpiSub}>ביצוע: {fmt(aExp)}</Text>}
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>חיסכון שנתי</Text>
            <Text style={s.kpiValue}>{fmt(pSavings)}</Text>
            <Text style={s.kpiSub}>חודשי: {fmt(pSavings / 12)}</Text>
            {activeMonths > 0 && <Text style={s.kpiSub}>ביצוע: {fmt(aSavings)}</Text>}
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>תזרים נטו</Text>
            <Text style={[s.kpiValue, { color: pCF >= 0 ? C.income : C.exp }]}>{fmt(pCF)}</Text>
            <Text style={s.kpiSub}>חודשי: {fmt(pCF / 12)}</Text>
            {activeMonths > 0 && <Text style={s.kpiSub}>ביצוע: {fmt(aCF)}</Text>}
          </View>
        </View>

        {/* Two-column section grid */}
        <View style={s.twoCol}>
          <View style={s.half}>
            <SectionTable title="הכנסות" rows={input.income} />
          </View>
          <View style={s.half}>
            <SectionTable title="הוצאות קבועות" rows={input.fixed} />
          </View>
        </View>
        <View style={s.twoCol}>
          <View style={s.half}>
            <SectionTable title="הוצאות משתנות" rows={input.variable} />
          </View>
          <View style={s.half}>
            <SectionTable title="מנויים וביטוחים" rows={input.sub} />
          </View>
        </View>
        <View style={s.twoCol}>
          <View style={s.half}>
            <SectionTable title="חיסכון" rows={input.savings} />
          </View>
          <View style={s.half}>
            <DebtTable rows={input.debt} />
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>The Home Economist · תכנון שנתי {input.year}</Text>
          <Text render={({ pageNumber, totalPages }) => `עמוד ${pageNumber} מתוך ${totalPages}`} />
        </View>
      </Page>

      {/* Page 2: Monthly breakdown — landscape */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View style={s.headerRow}>
            <Text style={s.brand}>The Home Economist</Text>
            <Text style={s.date}>הופק: {today}</Text>
          </View>
          <Text style={s.title}>פירוט חודשי {input.year}</Text>
          <Text style={s.subtitle}>תכנון מול ביצוע — כל הקטגוריות לפי חודש</Text>
        </View>

        <View style={s.table}>
          {/* Header row */}
          <View style={s.tHeadRow}>
            <Text style={[s.th, { flex: 1.4 }]}>קטגוריה</Text>
            {MONTH_SHORT.map(m => (
              <Text key={m} style={[s.th, { flex: 0.7, textAlign: 'center' }]}>{m}</Text>
            ))}
            <Text style={[s.th, { flex: 1, textAlign: 'center', color: C.gold }]}>שנתי</Text>
          </View>

          {([
            { label: 'הכנסות',        plan: pIncome / 12,   key: 'income'   as const, total: pIncome,   totalAct: aIncome },
            { label: 'קבועות',         plan: pFixed / 12,    key: 'fixed'    as const, total: pFixed,    totalAct: aFixed },
            { label: 'משתנות',         plan: pVariable / 12, key: 'variable' as const, total: pVariable, totalAct: aVariable },
            { label: 'מנויים+ביטוח',  plan: pSub / 12,      key: 'sub'      as const, total: pSub,      totalAct: aSub },
            { label: 'הלוואות',        plan: pDebt / 12,     key: 'debt'     as const, total: pDebt,     totalAct: aDebt },
            { label: 'חיסכון',         plan: pSavings / 12,  key: 'savings'  as const, total: pSavings,  totalAct: aSavings },
          ]).map((r, idx) => (
            <View key={r.label} style={idx % 2 === 0 ? s.tRow : s.tRowAlt}>
              <Text style={[s.td, { flex: 1.4, fontWeight: 'bold' }]}>{r.label}</Text>
              {acts.map((m, i) => {
                const act = m ? m[r.key] : null
                return (
                  <View key={i} style={{ flex: 0.7, padding: 2, alignItems: 'center' }}>
                    <Text style={{ fontSize: 7, color: C.gold }}>{r.plan > 0 ? fmt(r.plan) : '—'}</Text>
                    {m && <Text style={{ fontSize: 7, color: (act ?? 0) > 0 ? C.income : C.muted }}>{(act ?? 0) > 0 ? fmt(act!) : '—'}</Text>}
                  </View>
                )
              })}
              <View style={{ flex: 1, padding: 2, alignItems: 'center' }}>
                <Text style={{ fontSize: 8, fontWeight: 'bold', color: C.gold }}>{fmt(r.total)}</Text>
                {activeMonths > 0 && <Text style={{ fontSize: 7, color: C.income }}>{fmt(r.totalAct)}</Text>}
              </View>
            </View>
          ))}

          {/* Cash flow row */}
          <View style={s.tFootRow}>
            <Text style={[s.td, { flex: 1.4, fontWeight: 'bold' }]}>תזרים נטו</Text>
            {acts.map((m, i) => {
              const planNet = (pIncome - pFixed - pVariable - pSub - pDebt - pSavings) / 12
              const actNet  = m ? m.income - m.fixed - m.variable - m.sub - m.debt - m.savings : null
              return (
                <View key={i} style={{ flex: 0.7, padding: 2, alignItems: 'center' }}>
                  <Text style={{ fontSize: 7, color: planNet >= 0 ? C.income : C.exp }}>{(planNet >= 0 ? '+' : '') + fmt(planNet)}</Text>
                  {m && actNet !== null && <Text style={{ fontSize: 7, fontWeight: 'bold', color: actNet >= 0 ? C.income : C.exp }}>{(actNet >= 0 ? '+' : '') + fmt(actNet)}</Text>}
                </View>
              )
            })}
            <View style={{ flex: 1, padding: 2, alignItems: 'center' }}>
              <Text style={{ fontSize: 8, fontWeight: 'bold', color: pCF >= 0 ? C.income : C.exp }}>{(pCF >= 0 ? '+' : '') + fmt(pCF)}</Text>
              {activeMonths > 0 && <Text style={{ fontSize: 7, fontWeight: 'bold', color: aCF >= 0 ? C.income : C.exp }}>{(aCF >= 0 ? '+' : '') + fmt(aCF)}</Text>}
            </View>
          </View>
        </View>

        <View style={{ marginTop: 8, flexDirection: 'row-reverse', justifyContent: 'flex-start', gap: 12 }}>
          <Text style={{ fontSize: 7, color: C.gold }}>תכנון</Text>
          <Text style={{ fontSize: 7, color: C.income }}>ביצוע</Text>
          {activeMonths > 0 && <Text style={{ fontSize: 7, color: C.muted }}>{activeMonths} חודשים עם נתוני ביצוע</Text>}
        </View>

        <View style={s.footer} fixed>
          <Text>The Home Economist · תכנון שנתי {input.year}</Text>
          <Text render={({ pageNumber, totalPages }) => `עמוד ${pageNumber} מתוך ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function exportAnnualPdf(input: AnnualPdfInput) {
  const blob = await pdf(<AnnualPdfDocument input={input} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `תכנון-שנתי-${input.year}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
