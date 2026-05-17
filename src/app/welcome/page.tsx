'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ShaderAnimation } from '@/components/ui/shader-animation'

export default function WelcomePage() {
  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-[#0A0A0A]">

      {/* Brand background — visible at the image's faded edges */}
      <div aria-hidden className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%]  left-[8%]   w-[55vw] h-[55vw] max-w-[760px] max-h-[760px] rounded-full bg-gold/25       blur-[120px] animate-blob-a will-change-transform" />
        <div className="absolute top-[45%]  right-[5%]  w-[60vw] h-[60vw] max-w-[860px] max-h-[860px] rounded-full bg-gold-dark/30  blur-[140px] animate-blob-b will-change-transform" />
        <div className="absolute bottom-[2%] left-[28%] w-[45vw] h-[45vw] max-w-[640px] max-h-[640px] rounded-full bg-gold-light/15 blur-[110px] animate-blob-c will-change-transform" />
      </div>

      <div className="fixed inset-0 z-[1] pointer-events-none">
        <ShaderAnimation />
      </div>

      {/* Hero image — full-bleed, edges softened into brand background */}
      <motion.div
        className="absolute inset-0 z-[2]"
        initial={{ scale: 1.08, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease: 'easeOut' }}
      >
        <Image
          src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2400&auto=format&fit=crop"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{
            WebkitMaskImage:
              'radial-gradient(ellipse 95% 95% at center, #000 55%, transparent 100%)',
            maskImage:
              'radial-gradient(ellipse 95% 95% at center, #000 55%, transparent 100%)',
          }}
        />
        {/* Dark gradient for legibility of overlaid text */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/55 via-[#0A0A0A]/35 to-[#0A0A0A]/85" />
        {/* Warm gold wash to tie the photo into the brand palette */}
        <div className="absolute inset-0 bg-gold/10 mix-blend-overlay" />
      </motion.div>

      {/* Vignette */}
      <div
        aria-hidden
        className="absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.5)_75%,rgba(0,0,0,0.95)_100%)] pointer-events-none"
      />

      {/* Hero content — sits ON the image, fits in a single viewport */}
      <main className="relative z-10 min-h-[100dvh] flex items-center justify-center px-4 py-10 md:py-16">
        <div className="w-full max-w-3xl text-center">

          {/* Logo / brand mark */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 }}
            className="inline-flex items-center justify-center size-14 md:size-16 rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md mb-5 md:mb-7 shadow-[0_8px_32px_rgba(201,168,108,0.25)]"
          >
            <span className="text-3xl md:text-4xl drop-shadow-[0_2px_8px_rgba(201,168,108,0.5)]">🏠</span>
          </motion.div>

          {/* Title — huge, on top of the image */}
          <motion.h1
            initial={{ x: 200, opacity: 0, filter: 'blur(10px)' }}
            animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              x: { type: 'spring', stiffness: 75, damping: 18, mass: 0.9, delay: 0.2 },
              opacity: { duration: 1.0, ease: 'easeOut', delay: 0.2 },
              filter:  { duration: 0.9, ease: 'easeOut', delay: 0.2 },
            }}
            className="text-6xl sm:text-7xl md:text-8xl lg:text-[8.5rem] font-bold leading-[0.95] tracking-tight bg-gradient-to-b from-gold-light via-gold to-gold-dark bg-clip-text text-transparent drop-shadow-[0_8px_40px_rgba(201,168,108,0.4)]"
          >
            ברוכים הבאים
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ x: -120, opacity: 0, filter: 'blur(8px)' }}
            animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              x: { type: 'spring', stiffness: 80, damping: 20, mass: 0.8, delay: 0.45 },
              opacity: { duration: 0.9, ease: 'easeOut', delay: 0.45 },
              filter:  { duration: 0.8, ease: 'easeOut', delay: 0.45 },
            }}
            className="mt-3 md:mt-5 text-xl sm:text-2xl md:text-3xl text-white/90 font-medium drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
          >
            למערכת ניהול כלכלת הבית
          </motion.p>

          {/* Divider */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.7 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.7 }}
            className="flex items-center justify-center gap-3 my-6 md:my-7"
          >
            <span className="h-px w-12 md:w-16 bg-gradient-to-r from-transparent to-gold/70" />
            <span className="size-1.5 rounded-full bg-gold/80" />
            <span className="h-px w-12 md:w-16 bg-gradient-to-l from-transparent to-gold/70" />
          </motion.div>

          {/* Description */}
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.85 }}
            className="text-base md:text-lg text-white/85 leading-relaxed max-w-2xl mx-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
          >
            כאן יעמוד לרשותכם כל המידע הנדרש כדי שתהיו ב<span className="text-gold font-semibold">שליטה</span> על הכסף ועל ה<span className="text-gold font-semibold">מטרות</span> שלכם.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 1.05 }}
            className="mt-8 md:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href="/app/guide"
              className="group inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gold text-surface font-semibold text-base shadow-[0_8px_32px_rgba(201,168,108,0.4)] hover:bg-gold-light hover:shadow-[0_8px_40px_rgba(224,200,150,0.5)] transition-all duration-200"
            >
              התחילו עם המדריך
              <span aria-hidden className="transition-transform duration-200 group-hover:-translate-x-1">←</span>
            </Link>

            <Link
              href="/app/credit"
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3.5 rounded-xl border border-white/15 bg-white/[0.06] backdrop-blur-md text-white/90 text-sm hover:bg-white/[0.12] hover:text-white transition-all"
            >
              דלגו ישר למערכת
            </Link>
          </motion.div>

        </div>
      </main>
    </div>
  )
}
