'use client'

import Link from 'next/link'
import ScrollExpandMedia from '@/components/ui/scroll-expansion-hero'
import { ShaderAnimation } from '@/components/ui/shader-animation'

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#0A0A0A]">

      {/* Brand background — animated CSS blob mesh (no-WebGL fallback) */}
      <div aria-hidden className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%]  left-[8%]   w-[55vw] h-[55vw] max-w-[760px] max-h-[760px] rounded-full bg-gold/25       blur-[120px] animate-blob-a will-change-transform" />
        <div className="absolute top-[45%]  right-[5%]  w-[60vw] h-[60vw] max-w-[860px] max-h-[860px] rounded-full bg-gold-dark/30  blur-[140px] animate-blob-b will-change-transform" />
        <div className="absolute bottom-[2%] left-[28%] w-[45vw] h-[45vw] max-w-[640px] max-h-[640px] rounded-full bg-gold-light/15 blur-[110px] animate-blob-c will-change-transform" />
      </div>

      {/* Brand background — animated WebGL shader (overlays the CSS mesh when supported) */}
      <div className="fixed inset-0 z-[1] pointer-events-none">
        <ShaderAnimation />
      </div>

      {/* Vignette overlay */}
      <div
        aria-hidden
        className="fixed inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.6)_70%,rgba(0,0,0,0.95)_100%)] pointer-events-none"
      />

      {/* Scroll-to-expand hero on top of brand background */}
      <div className="relative z-10">
        <ScrollExpandMedia
          mediaType="image"
          mediaSrc="https://images.unsplash.com/photo-1554224155-6726b3ff858f?q=80&w=1920&auto=format&fit=crop"
          title="ברוכים הבאים"
          date="למערכת ניהול כלכלת הבית"
          scrollToExpand="גללו לחשיפת המערכת"
        >
          <WelcomeContent />
        </ScrollExpandMedia>
      </div>

    </div>
  )
}

function WelcomeContent() {
  return (
    <div className="max-w-3xl mx-auto text-center">

      {/* Logo / brand mark */}
      <div className="inline-flex items-center justify-center size-20 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-md mb-8 shadow-[0_8px_32px_rgba(201,168,108,0.25)]">
        <span className="text-4xl drop-shadow-[0_2px_8px_rgba(201,168,108,0.4)]">🏠</span>
      </div>

      <h2 className="text-3xl md:text-4xl font-bold mb-4 bg-gradient-to-b from-gold-light via-gold to-gold-dark bg-clip-text text-transparent">
        כל מה שאתם צריכים בשביל לשלוט בכסף
      </h2>

      {/* Divider ornament */}
      <div className="flex items-center justify-center gap-3 my-6 opacity-60">
        <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold/60" />
        <span className="size-1.5 rounded-full bg-gold/70" />
        <span className="h-px w-12 bg-gradient-to-l from-transparent to-gold/60" />
      </div>

      <p className="text-base md:text-lg text-white/80 leading-relaxed">
        כאן יעמוד לרשותכם כל המידע הנדרש כדי שתהיו ב<span className="text-gold font-semibold">שליטה</span> על הכסף ועל ה<span className="text-gold font-semibold">מטרות</span> שלכם.
      </p>

      {/* Feature chips */}
      <div className="mt-8 flex flex-wrap justify-center gap-2 sm:gap-3">
        {[
          { icon: '💳', label: 'מיפוי אשראי' },
          { icon: '🏦', label: 'תזרים עו"ש' },
          { icon: '📊', label: 'תכנון חודשי' },
          { icon: '📈', label: 'מגמות שנתיות' },
          { icon: '🎯', label: 'מטרות חיסכון' },
        ].map((f) => (
          <span
            key={f.label}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md px-4 py-2 text-sm text-white/85"
          >
            <span aria-hidden>{f.icon}</span>
            {f.label}
          </span>
        ))}
      </div>

      {/* CTAs */}
      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/app/guide"
          className="group inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gold text-surface font-semibold text-base shadow-[0_8px_32px_rgba(201,168,108,0.35)] hover:bg-gold-light hover:shadow-[0_8px_40px_rgba(224,200,150,0.45)] transition-all duration-200"
        >
          התחילו עם המדריך
          <span aria-hidden className="transition-transform duration-200 group-hover:-translate-x-1">←</span>
        </Link>

        <Link
          href="/app/credit"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3.5 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md text-white/85 text-sm hover:bg-white/[0.08] hover:text-white transition-all"
        >
          דלגו ישר למערכת
        </Link>
      </div>

    </div>
  )
}
