import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { EmailAuthForm } from '@/components/auth/EmailAuthForm'

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-surface2 border border-line mb-4">
            <span className="text-2xl">🏠</span>
          </div>
          <h1 className="text-2xl font-bold text-gold">The Home Economist</h1>
          <p className="text-muted-txt text-sm mt-1">מיפוי פיננסי חכם</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-line bg-surface2 p-6 shadow-xl space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-txt mb-1">כניסה למערכת</h2>
            <p className="text-muted-txt text-sm">כנסו עם מייל או חשבון Google</p>
          </div>

          <EmailAuthForm />

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-line" />
            <span className="text-xs text-muted-txt">או</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          <GoogleSignInButton />

          <p className="text-muted-txt text-xs text-center leading-relaxed">
            בכניסה למערכת אתם מסכימים לתנאי השימוש
            <br />ומדיניות הפרטיות שלנו
          </p>
        </div>

      </div>
    </div>
  )
}
