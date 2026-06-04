import { describe, it, expect } from 'vitest'
import { categorize } from '@/lib/categorize'
import { SUB_CATEGORIES, ALL_CATEGORIES, CATEGORY_ICONS } from '@/lib/constants'

// Regression net for the "מנויים" rollout (June 2026). Every Israeli credit
// statement should route the common subscription merchants into mapping.sub
// via the SUB_CATEGORIES classification. Adding a merchant to BUSINESS_DB
// → "מנויים" is only useful if (1) "מנויים" stays in SUB_CATEGORIES and
// (2) the merchant strings here keep matching. This test guards both.

describe('Subscription category — well-formedness', () => {
  it('"מנויים" appears in ALL_CATEGORIES exactly once', () => {
    const occurrences = ALL_CATEGORIES.filter(c => c === 'מנויים')
    expect(occurrences).toHaveLength(1)
  })

  it('"מנויים" is classified as SUB so it routes to the מנויים section in mapping', () => {
    expect(SUB_CATEGORIES.has('מנויים')).toBe(true)
  })

  it('"מנויים" has an icon (so the UI does not render a blank square)', () => {
    expect(CATEGORY_ICONS['מנויים']).toBeTruthy()
  })
})

describe('Subscription merchants — categorize() routes them to "מנויים"', () => {
  const expectMnoyim = (desc: string) =>
    expect(categorize(desc), `"${desc}" should be classified as מנויים`).toBe('מנויים')

  it('Israeli telcos (Cellcom, Partner, Pelephone, Hot Mobile, Bezeq, Yes)', () => {
    expectMnoyim('CELLCOM 12/24')
    expectMnoyim('סלקום')
    expectMnoyim('PARTNER COMM LTD')
    expectMnoyim('פרטנר תקשורת')
    expectMnoyim('Pelephone')
    expectMnoyim('פלאפון')
    expectMnoyim('HOT MOBILE')
    expectMnoyim('הוט מובייל')
    expectMnoyim('BEZEQ INTERNATIONAL')
    expectMnoyim('בזק')
    expectMnoyim('YES TV')
    expectMnoyim('יס')
  })

  it('Streaming video (Netflix, Disney+, Apple TV+, HBO Max, Paramount+, YouTube Premium)', () => {
    expectMnoyim('NETFLIX.COM 28/05')
    expectMnoyim('Netflix')
    expectMnoyim('DISNEY PLUS')
    expectMnoyim('DISNEY+')
    expectMnoyim('APPLE TV+')
    expectMnoyim('HBO MAX')
    expectMnoyim('PARAMOUNT PLUS')
    expectMnoyim('YOUTUBE PREMIUM')
  })

  it('Music & audio (Spotify, Apple Music, Audible, Storytel)', () => {
    expectMnoyim('SPOTIFY P0123456')
    expectMnoyim('APPLE MUSIC')
    expectMnoyim('AUDIBLE.COM')
    expectMnoyim('Storytel')
  })

  it('SaaS / cloud (Microsoft 365, Adobe, Dropbox, iCloud, Notion, Slack)', () => {
    expectMnoyim('MICROSOFT 365 SUB')
    expectMnoyim('Adobe Creative Cloud')
    expectMnoyim('ADOBE INC')
    expectMnoyim('DROPBOX*INC')
    expectMnoyim('iCloud')
    expectMnoyim('Notion Labs Inc')
    expectMnoyim('Slack T01234')
  })

  it('AI tools (ChatGPT, Claude, Perplexity, Cursor)', () => {
    expectMnoyim('OPENAI *CHATGPT')
    expectMnoyim('Anthropic Claude.ai')
    expectMnoyim('Perplexity AI')
    expectMnoyim('Cursor AI')
  })

  it('Newspapers (Haaretz, Ynet+, Calcalist, NYT, WSJ)', () => {
    expectMnoyim('הארץ דיגיטל')
    expectMnoyim('Ynet+')
    expectMnoyim('כלכליסט פלוס')
    expectMnoyim('NEW YORK TIMES')
    expectMnoyim('NYTimes.com')
    expectMnoyim('WSJ.com')
  })

  it('Wolt+ / 10bis Plus / HelloFresh (food subs — NOT plain Wolt/10bis)', () => {
    expectMnoyim('WOLT PLUS MONTHLY')
    expectMnoyim('10BIS PLUS')
    expectMnoyim('HelloFresh')
  })

  it('VPN services (NordVPN, ExpressVPN, Surfshark)', () => {
    expectMnoyim('NORDVPN')
    expectMnoyim('EXPRESSVPN')
    expectMnoyim('Surfshark')
  })

  it('Israeli newspapers (TheMarker, Globes, Maariv)', () => {
    expectMnoyim('TheMarker')
    expectMnoyim('GLOBES')
    expectMnoyim('מעריב')
  })
})

describe('Variable-purchase merchants — should NOT be routed to "מנויים"', () => {
  it('apple.com/bill stays as variable (App Store purchases are not all subs)', () => {
    // The merchant string contains "apple" but the longer key "apple.com/bill"
    // wins because of the length-descending sort. iTunes purchases land in
    // תקשורת which is now in VAR_CATEGORIES → mapping.variable.
    expect(categorize('APPLE.COM/BILL ITUNES.COM IE')).toBe('תקשורת')
  })

  it('plain Wolt (non-Plus) stays as restaurant orders, not subs', () => {
    expect(categorize('WOLT 28/05')).toBe('אוכל בחוץ ובילויים')
  })
})
