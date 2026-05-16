import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { EmailAuthForm } from '@/components/auth/EmailAuthForm'
import { ShaderAnimation } from '@/components/ui/shader-animation'

export default function AuthPage() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0A0A0A]">

      {/* Animated CSS blob mesh — pure CSS, runs everywhere (no-WebGL fallback) */}
      <div aria-hidden className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[15%] left-[10%] w-[55vw] h-[55vw] max-w-[700px] max-h-[700px] rounded-full bg-gold/25 blur-[120px] animate-blob-a will-change-transform" />
        <div className="absolute top-[40%] right-[5%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] rounded-full bg-gold-dark/30 blur-[140px] animate-blob-b will-change-transform" />
        <div className="absolute bottom-[5%] left-[30%] w-[45vw] h-[45vw] max-w-[600px] max-h-[600px] rounded-full bg-gold-light/15 blur-[110px] animate-blob-c will-change-transform" />
      </div>

      {/* Animated shader background (overlays the CSS mesh when WebGL is available) */}
      <div className="absolute inset-0 z-[1]">
        <ShaderAnimation />
      </div>

      {/* Vignette overlay — darkens edges so the glass card pops */}
      <div className="absolute inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_70%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />

      {/* Foreground content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md mb-4 shadow-lg">
              <span className="text-2xl">🏠</span>
            </div>
            <h1 className="text-2xl font-bold text-gold drop-shadow-[0_2px_12px_rgba(201,168,108,0.4)]">
              The Home Economist
            </h1>
            <p className="text-white/70 text-sm mt-1">מיפוי פיננסי חכם</p>
          </div>

          {/* Glass login card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-txt mb-1">כניסה למערכת</h2>
              <p className="text-white/60 text-sm">כנסו עם מייל או חשבון Google</p>
            </div>

            <EmailAuthForm />

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/50">או</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <GoogleSignInButton />

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
