'use client'

import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer'
import type { Meeting } from '@/stores/meetingsStore'
import { MEETING_LABELS } from '@/stores/meetingsStore'

Font.register({
  family: 'Heebo',
  fonts: [
    { src: '/fonts/Heebo-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Heebo-Bold.ttf',    fontWeight: 'bold' },
  ],
})

const C = {
  gold:  '#A88844',
  txt:   '#1A1A1A',
  muted: '#6B6357',
  line:  '#D8CFB7',
  bgAlt: '#F8F3E7',
}

const s = StyleSheet.create({
  page: {
    padding: 32,
    fontFamily: 'Heebo',
    fontSize: 10.5,
    color: C.txt,
    backgroundColor: '#FFFFFF',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: C.gold,
    paddingBottom: 8,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 10, color: C.gold, fontWeight: 'bold' },
  date: { fontSize: 9, color: C.muted },
  badge: {
    alignSelf: 'flex-end',
    backgroundColor: C.bgAlt,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 9,
    color: C.gold,
    marginTop: 6,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: C.gold, textAlign: 'right', marginTop: 6 },
  meta: { fontSize: 9, color: C.muted, textAlign: 'right', marginTop: 2 },

  sectionTitle: { fontSize: 12, fontWeight: 'bold', color: C.gold, marginTop: 14, marginBottom: 6, textAlign: 'right' },
  body: { fontSize: 10.5, lineHeight: 1.55, textAlign: 'right' },
  blockBox: {
    borderWidth: 1, borderColor: C.line, borderRadius: 4,
    padding: 10, backgroundColor: '#FCFAF4',
  },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32, right: 32,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    fontSize: 7,
    color: C.muted,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 4,
  },
})

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function MeetingPdfDocument({ meeting }: { meeting: Meeting }) {
  const today = new Date().toLocaleDateString('he-IL')
  return (
    <Document title={meeting.title} author="The Home Economist">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerRow}>
            <Text style={s.brand}>The Home Economist</Text>
            <Text style={s.date}>הופק: {today}</Text>
          </View>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Text style={s.badge}>{MEETING_LABELS[meeting.type]}</Text>
            <Text style={s.meta}>תאריך פגישה: {formatDate(meeting.date)}</Text>
          </View>
          <Text style={s.title}>{meeting.title || `סיכום ${MEETING_LABELS[meeting.type]}`}</Text>
        </View>

        <Text style={s.sectionTitle}>סיכום הפגישה</Text>
        <View style={s.blockBox}>
          <Text style={s.body}>{meeting.summary || '—'}</Text>
        </View>

        {meeting.actionItems.trim().length > 0 && (
          <>
            <Text style={s.sectionTitle}>משימות להמשך</Text>
            <View style={s.blockBox}>
              <Text style={s.body}>{meeting.actionItems}</Text>
            </View>
          </>
        )}

        <View style={s.footer} fixed>
          <Text>The Home Economist · סיכום פגישה</Text>
          <Text render={({ pageNumber, totalPages }) => `עמוד ${pageNumber} מתוך ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function exportMeetingPdf(meeting: Meeting) {
  const blob = await pdf(<MeetingPdfDocument meeting={meeting} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = (meeting.title || MEETING_LABELS[meeting.type]).replace(/[\\/:*?"<>|]/g, '-')
  a.download = `${safeName}-${meeting.date}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
