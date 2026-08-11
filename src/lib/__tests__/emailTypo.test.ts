import { describe, it, expect } from 'vitest'
import { suggestEmailFix } from '../emailTypo'

describe('suggestEmailFix', () => {
  it('catches the exact address that caused the incident', () => {
    // The real client, 2026-08-11. This is the whole reason the module exists.
    expect(suggestEmailFix('gac2014n@gmail.con')).toBe('gac2014n@gmail.com')
  })

  it('fixes dead top-level domains on any host', () => {
    expect(suggestEmailFix('a@company.con')).toBe('a@company.com')
    expect(suggestEmailFix('a@gmail.cmo')).toBe('a@gmail.com')
    expect(suggestEmailFix('a@gmail.ocm')).toBe('a@gmail.com')
  })

  it('fixes known misspelled providers', () => {
    expect(suggestEmailFix('a@gmial.com')).toBe('a@gmail.com')
    expect(suggestEmailFix('a@gmail.co')).toBe('a@gmail.com')
    expect(suggestEmailFix('a@hotmial.com')).toBe('a@hotmail.com')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(suggestEmailFix('  Gac@GMAIL.CON ')).toBe('gac@gmail.com')
  })

  it('leaves correct addresses alone', () => {
    for (const good of [
      'gac2014n@gmail.com',
      'ori@orimipuy.com',
      'someone@yahoo.com',
      'a@outlook.com',
    ]) {
      expect(suggestEmailFix(good)).toBeNull()
    }
  })

  it('never touches real Israeli domains that merely look odd', () => {
    // .co.il ends in a real TLD and walla.co.il is a real mailbox — a fuzzy
    // matcher would "fix" these and lock the client out of their own address.
    expect(suggestEmailFix('a@walla.co.il')).toBeNull()
    expect(suggestEmailFix('a@company.co.il')).toBeNull()
    expect(suggestEmailFix('a@gov.il')).toBeNull()
    expect(suggestEmailFix('a@something.co')).toBeNull()
  })

  it('has no opinion on malformed input', () => {
    for (const junk of ['', '   ', 'not-an-email', '@gmail.con', 'a@', 'a@b@gmail.con']) {
      expect(suggestEmailFix(junk)).toBeNull()
    }
  })
})
