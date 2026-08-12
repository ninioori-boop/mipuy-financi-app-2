import { describe, it, expect, afterEach } from 'vitest'
import { canOpenExternalSchemes, embeddedKind } from '@/lib/isEmbedded'

/**
 * A client on the WhatsApp connect screen taps one button. Whether that button
 * can work at all depends on which shell is rendering it, and getting the answer
 * wrong is not cosmetic: an old Android shell cannot open `whatsapp://` and
 * replaces the whole page with ERR_UNKNOWN_URL_SCHEME, stranding a client who
 * now holds a linking code with no way to send it. That is what happened in
 * production on 11/08/2026.
 *
 * So the refusal is the case worth pinning: an app that has not declared the
 * capability must NOT be offered the link, no matter how new it looks.
 */

const REAL_UA = navigator.userAgent

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

afterEach(() => {
  setUserAgent(REAL_UA)
  sessionStorage.clear()
})

// A stock Android WebView UA: the `; wv)` token is what marks it as embedded.
const OLD_SHELL = 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
const NEW_SHELL = `${OLD_SHELL} MipuyApp ExtSchemes/1`
const CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'

describe('canOpenExternalSchemes — who may be shown a wa.me link', () => {
  it('refuses an Android shell that has not declared the capability', () => {
    setUserAgent(OLD_SHELL)
    expect(embeddedKind()).toBe('android-app')
    expect(canOpenExternalSchemes()).toBe(false)
  })

  it('allows the shell that stamps the marker', () => {
    setUserAgent(NEW_SHELL)
    expect(embeddedKind()).toBe('android-app')
    expect(canOpenExternalSchemes()).toBe(true)
  })

  it('allows a plain mobile browser, which has always handled these schemes', () => {
    setUserAgent(CHROME)
    expect(embeddedKind()).toBeNull()
    expect(canOpenExternalSchemes()).toBe(true)
  })

  it('refuses a shell detected through the embed flag rather than the user agent', () => {
    // /connect/expenses bootstraps the WebView by setting this, and an old shell
    // arriving that way is just as unable to open whatsapp://.
    setUserAgent(CHROME)
    sessionStorage.setItem('embedMode', '1')
    expect(embeddedKind()).toBe('android-app')
    expect(canOpenExternalSchemes()).toBe(false)
  })

  it('is not fooled by the marker appearing as a substring of something else', () => {
    setUserAgent(`${OLD_SHELL} NotExtSchemes/12`)
    expect(canOpenExternalSchemes()).toBe(false)
  })
})
