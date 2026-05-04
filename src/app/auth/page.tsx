import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

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
        <div className="rounded-2xl border border-line bg-surface2 p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-txt mb-1">כניסה למערכת</h2>
          <p className="text-muted-txt text-sm mb-6">כנסו עם חשבון Google שלכם</p>
          <GoogleSignInButton />
          <p className="text-muted-txt text-xs text-center mt-5 leading-relaxed">
            בכניסה למערכת אתם מסכימים לתנאי השימוש
            <br />ומדיניות הפרטיות שלנו
          </p>
        </div>

      </div>
    </div>
  )
}
