import { describe, it, expect } from 'vitest'
import {
  normalizeCurrency, detectCurrency, mentionedCurrency, extractMoney, formatMoney, formatMoneyLoose,
} from '../currency'

// The bug these tests exist for: a client paid £45 abroad and the system
// recorded ₪45. Every parser threw the currency symbol away and kept the digits,
// so a charge made overseas was under-reported by ~4x.

describe('normalizeCurrency', () => {
  it('accepts ISO codes in any case', () => {
    expect(normalizeCurrency('GBP')).toBe('GBP')
    expect(normalizeCurrency('gbp')).toBe('GBP')
    expect(normalizeCurrency(' usd ')).toBe('USD')
  })

  it('accepts symbols and Hebrew words', () => {
    expect(normalizeCurrency('£')).toBe('GBP')
    expect(normalizeCurrency('$')).toBe('USD')
    expect(normalizeCurrency('€')).toBe('EUR')
    expect(normalizeCurrency('₪')).toBe('ILS')
    expect(normalizeCurrency('פאונד')).toBe('GBP')
    expect(normalizeCurrency('דולר')).toBe('USD')
    expect(normalizeCurrency('יורו')).toBe('EUR')
    expect(normalizeCurrency('ש"ח')).toBe('ILS')
  })

  it('returns null for anything unrecognized, never throws', () => {
    expect(normalizeCurrency('JPY')).toBeNull()
    expect(normalizeCurrency('')).toBeNull()
    expect(normalizeCurrency(undefined)).toBeNull()
    expect(normalizeCurrency(42)).toBeNull()
  })
})

describe('detectCurrency', () => {
  it('reads the symbol on either side of the number', () => {
    expect(detectCurrency('£45.00')).toBe('GBP')
    expect(detectCurrency('45.00 £')).toBe('GBP')
    expect(detectCurrency('$32.83')).toBe('USD')
    expect(detectCurrency('€19,90')).toBe('EUR')
  })

  it('prefers ILS when the notification carries both figures', () => {
    // Wallet sometimes shows the issuer's own conversion alongside the original.
    // That number beats any rate we could look up, so it must win.
    expect(detectCurrency('£45.00 (₪212.50)')).toBe('ILS')
  })

  it('returns null when no currency is stated', () => {
    expect(detectCurrency('עסקה בסך 45.00 בכרטיס')).toBeNull()
  })
})

describe('mentionedCurrency', () => {
  it('finds a currency named away from the number', () => {
    // The real failure: Israeli apps write "בסך <number>" with the currency
    // elsewhere in the sentence, so nothing is adjacent to the digits.
    expect(mentionedCurrency('חיוב במטבע פאונד, עסקה בסך 45.00')).toBe('GBP')
  })

  it('stays silent when shekels are mentioned at all', () => {
    expect(mentionedCurrency('עסקה בסך 45.00 ₪ בכרטיס')).toBeNull()
  })

  it('stays silent when two foreign currencies appear', () => {
    // Ambiguous — guessing wrong multiplies the charge by ~4.
    expect(mentionedCurrency('המרה מ-דולר ל-יורו בסך 45')).toBeNull()
  })

  it('does not fire on currency words buried inside ordinary Hebrew', () => {
    // The expensive false positive: a DOMESTIC charge read as foreign would be
    // multiplied by ~4. A merchant name must never be mistaken for a currency.
    expect(mentionedCurrency('עסקה בסך 50 בכרטיס יורונט')).toBeNull()   // יורו inside יורונט
    expect(mentionedCurrency('עסקה בסך 50 אצל שחר תקשורת')).toBeNull()  // שח inside שחר
    expect(mentionedCurrency('עסקה בסך 50 במכון משקל')).toBeNull()      // שקל inside משקל
  })

  it('still fires when the word stands alone', () => {
    expect(mentionedCurrency('חיוב במטבע פאונד בסך 45.00')).toBe('GBP')
    expect(mentionedCurrency('חיוב בדולר בסך 45.00')).toBe('USD')
  })
})

describe('extractMoney', () => {
  it('keeps existing shekel behaviour byte-for-byte', () => {
    expect(extractMoney('עסקה בסך 12.57 ₪ בכרטיס max')).toMatchObject({ amount: 12.57, currency: 'ILS' })
    expect(extractMoney('₪55.21 with Hever GMC ••5070')).toMatchObject({ amount: 55.21, currency: 'ILS' })
    expect(extractMoney('1,234.56 ש"ח')).toMatchObject({ amount: 1234.56, currency: 'ILS' })
  })

  it('captures foreign charges with their currency', () => {
    expect(extractMoney('£45.00 Tesco')).toMatchObject({ amount: 45, currency: 'GBP' })
    expect(extractMoney('Starbucks $6.75')).toMatchObject({ amount: 6.75, currency: 'USD' })
    expect(extractMoney('45.00 GBP')).toMatchObject({ amount: 45, currency: 'GBP' })
  })

  it('resolves the reported bug: 45 pounds is not 45 shekels', () => {
    const m = extractMoney('עסקה בסך 45.00 £ בכרטיס')
    expect(m).toMatchObject({ amount: 45, currency: 'GBP' })
  })

  it('prefers the shekel figure when both are present', () => {
    expect(extractMoney('£45.00 (₪212.50)')).toMatchObject({ amount: 212.5, currency: 'ILS' })
  })

  it('falls back to a bare number as shekels', () => {
    expect(extractMoney('עסקה בסך 89.90 בשופרסל')).toMatchObject({ amount: 89.9, currency: 'ILS' })
  })

  it('returns the matched span so the caller can strip it from the merchant', () => {
    const m = extractMoney('£45.00 Tesco')!
    expect('£45.00 Tesco'.replace(m.matched, '').trim()).toBe('Tesco')
  })

  // 🔴 A real ₪19.00 charge landed as ₪119 (2026-08-17). Merchant "Ilans
  // Terminal 1", shortcut sent name-then-amount, and taking the first number
  // picked up the name's digit. Any merchant with a digit was affected.
  describe('a digit inside the merchant name must not become the amount', () => {
    it('prefers the figure written with agorot, wherever it sits', () => {
      expect(extractMoney('Ilans Terminal 1 19.00')).toMatchObject({ amount: 19 })
      expect(extractMoney('AM:PM 24 45.90')).toMatchObject({ amount: 45.9 })
      expect(extractMoney('סניף 7 32.50')).toMatchObject({ amount: 32.5 })
      expect(extractMoney('רמי לוי 6 שופרסל 128.40')).toMatchObject({ amount: 128.4 })
    })

    it('leaves the merchant name intact once the amount is stripped', () => {
      const m = extractMoney('AM:PM 24 45.90')!
      expect('AM:PM 24 45.90'.replace(m.matched, '').trim()).toBe('AM:PM 24')
    })

    it('still reads the official shortcut order, amount first', () => {
      expect(extractMoney('19.00 Ilans Terminal 1')).toMatchObject({ amount: 19 })
      expect(extractMoney('45.90 AM:PM 24')).toMatchObject({ amount: 45.9 })
    })

    it('cannot rescue digits that genuinely merged, and does not pretend to', () => {
      // "Ilans Terminal 1" + "19.00" with no space between them. The 1 and the
      // 19.00 are one token by the time we see it; the fix is the shortcut.
      expect(extractMoney('Ilans Terminal 119.00')).toMatchObject({ amount: 119 })
    })

    it('keeps the first-number fallback when nothing carries agorot', () => {
      expect(extractMoney('סניף 7 מכולת 32')).toMatchObject({ amount: 7 })
    })

    // 🔴 Found by review before this shipped. "17.08.26" matches as "17.08", so
    // preferring the agorot shape would have read a date as the charge — a far
    // worse failure than the ₪119 that started this, because ₪17.08 looks like a
    // real amount and nobody re-checks it.
    it('does not mistake a dotted date or time for the amount', () => {
      expect(extractMoney('19 Ilans Terminal 1 17.08.26')).toMatchObject({ amount: 19 })
      expect(extractMoney('50 חנות 17.08.26 בשעה 14.30.05')).toMatchObject({ amount: 50 })
      // A genuine amount still wins over the date beside it.
      expect(extractMoney('חנות 17.08.26 45.90')).toMatchObject({ amount: 45.9 })
    })

    // Committing to a single candidate must not turn a capture the old code
    // recorded into a refusal.
    it('skips an unusable candidate instead of failing the whole capture', () => {
      expect(extractMoney('45 חנות 0.00')).toMatchObject({ amount: 45 })
    })
  })

  it('returns null when there is no number at all', () => {
    expect(extractMoney('עסקה נדחתה')).toBeNull()
    expect(extractMoney('')).toBeNull()
  })
})

describe('formatMoney', () => {
  it('renders the right symbol with no decimals', () => {
    expect(formatMoney(212.5, 'ILS')).toBe('₪213')
    expect(formatMoney(45, 'GBP')).toBe('£45')
  })

  it('renders an unknown persisted code rather than dropping it', () => {
    expect(formatMoneyLoose(45, 'GBP')).toBe('£45')
    expect(formatMoneyLoose(45, 'JPY')).toBe('45 JPY')
  })
})
