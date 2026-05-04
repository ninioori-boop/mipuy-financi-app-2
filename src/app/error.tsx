'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-line bg-surface2 p-8 text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-xl font-bold text-txt">משהו השתבש</h2>
        <p className="text-sm text-muted-txt">{error.message ?? 'שגיאה לא צפויה — נסה שוב'}</p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-gold text-surface text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          נסה שוב
        </button>
      </div>
    </div>
  )
}
