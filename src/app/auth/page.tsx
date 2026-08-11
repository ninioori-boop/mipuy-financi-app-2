import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { EmailAuthForm } from '@/components/auth/EmailAuthForm'
import { BrandNameEn, BrandTagline, BrandMark } from '@/components/layout/BrandProvider'

export default function AuthPage() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0A0A0A]">

      {/* Animated CSS blob mesh. This IS the background — it used to sit under a
          three.js shader canvas, but that pulled 1.4MB of WebGL library onto the
          very first screen every visitor sees, just to overlay some thin light
          rays. Removed; the mesh below runs everywhere at zero download cost. */}
      <div aria-hidden className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[15%] left-[10%] w-[55vw] h-[55vw] max-w-[700px] max-h-[700px] rounded-full bg-gold/25 blur-[120px] animate-blob-a will-change-transform" />
        <div className="absolute top-[40%] right-[5%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] rounded-full bg-gold-dark/30 blur-[140px] animate-blob-b will-change-transform" />
        <div className="absolute bottom-[5%] left-[30%] w-[45vw] h-[45vw] max-w-[600px] max-h-[600px] rounded-full bg-gold-light/15 blur-[110px] animate-blob-c will-change-transform" />
      </div>

      {/* Vignette overlay — darkens edges so the glass card pops */}
      <div className="absolute inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_70%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />

      {/* Foreground content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md mb-4 shadow-lg overflow-hidden">
              <BrandMark className="text-2xl max-h-10 w-auto" />
            </div>
            <h1 suppressHydrationWarning data-brand="nameEn" className="text-2xl font-bold text-[color:var(--wordmark,var(--gold))] drop-shadow-[0_2px_12px_color-mix(in_srgb,var(--gold)_40%,transparent)]">
              <BrandNameEn />
            </h1>
            <p suppressHydrationWarning data-brand="tagline" className="text-white/70 text-sm mt-1"><BrandTagline /></p>
          </div>

          {/* Glass login card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-txt mb-1">כניסה למערכת</h2>
              <p className="text-white/60 text-sm">כנסו עם חשבון Google או עם מייל וסיסמה</p>
            </div>

            {/* Google first, deliberately. Typing an address by hand on a phone
                is how a client registered `...@gmail.con` and locked herself
                out of a verification mail that could never arrive; Google
                supplies the address AND comes pre-verified, so it skips both
                failure modes. Email+password stays fully available below. */}
            <div className="space-y-2">
              <GoogleSignInButton />
              <p className="text-white/50 text-xs text-center">
                הדרך המהירה: בלי להקליד כתובת ובלי מייל אימות
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/50">או</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <EmailAuthForm />

            <p className="text-white/50 text-xs text-center leading-relaxed">
              בכניסה למערכת אתם מסכימים ל
              <a href="/privacy" target="_blank" className="text-gold hover:underline mx-0.5">
                תנאי השימוש ומדיניות הפרטיות
              </a>
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
