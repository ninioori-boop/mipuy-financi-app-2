'use client'

import {
  useEffect,
  useRef,
  useState,
  ReactNode,
  TouchEvent,
  WheelEvent,
} from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'

interface ScrollExpandMediaProps {
  mediaType?: 'video' | 'image'
  mediaSrc: string
  posterSrc?: string
  /** Optional background image. When omitted, the host page's own background shows through. */
  bgImageSrc?: string
  title?: string
  date?: string
  scrollToExpand?: string
  textBlend?: boolean
  children?: ReactNode
}

const ScrollExpandMedia = ({
  mediaType = 'video',
  mediaSrc,
  posterSrc,
  bgImageSrc,
  title,
  date,
  scrollToExpand,
  textBlend,
  children,
}: ScrollExpandMediaProps) => {
  const [scrollProgress, setScrollProgress] = useState<number>(0)
  const [showContent, setShowContent] = useState<boolean>(false)
  const [mediaFullyExpanded, setMediaFullyExpanded] = useState<boolean>(false)
  const [touchStartY, setTouchStartY] = useState<number>(0)
  const [isMobileState, setIsMobileState] = useState<boolean>(false)

  const sectionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setScrollProgress(0)
    setShowContent(false)
    setMediaFullyExpanded(false)
  }, [mediaType])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (mediaFullyExpanded && e.deltaY < 0 && window.scrollY <= 5) {
        setMediaFullyExpanded(false)
        e.preventDefault()
      } else if (!mediaFullyExpanded) {
        e.preventDefault()
        const scrollDelta = e.deltaY * 0.0009
        const newProgress = Math.min(
          Math.max(scrollProgress + scrollDelta, 0),
          1
        )
        setScrollProgress(newProgress)

        if (newProgress >= 1) {
          setMediaFullyExpanded(true)
          setShowContent(true)
        } else if (newProgress < 0.75) {
          setShowContent(false)
        }
      }
    }

    const handleTouchStart = (e: TouchEvent) => {
      setTouchStartY(e.touches[0].clientY)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartY) return

      const touchY = e.touches[0].clientY
      const deltaY = touchStartY - touchY

      if (mediaFullyExpanded && deltaY < -20 && window.scrollY <= 5) {
        setMediaFullyExpanded(false)
        e.preventDefault()
      } else if (!mediaFullyExpanded) {
        e.preventDefault()
        const scrollFactor = deltaY < 0 ? 0.008 : 0.005
        const scrollDelta = deltaY * scrollFactor
        const newProgress = Math.min(
          Math.max(scrollProgress + scrollDelta, 0),
          1
        )
        setScrollProgress(newProgress)

        if (newProgress >= 1) {
          setMediaFullyExpanded(true)
          setShowContent(true)
        } else if (newProgress < 0.75) {
          setShowContent(false)
        }

        setTouchStartY(touchY)
      }
    }

    const handleTouchEnd = (): void => {
      setTouchStartY(0)
    }

    const handleScroll = (): void => {
      if (!mediaFullyExpanded) {
        window.scrollTo(0, 0)
      }
    }

    window.addEventListener('wheel', handleWheel as unknown as EventListener, {
      passive: false,
    })
    window.addEventListener('scroll', handleScroll as EventListener)
    window.addEventListener(
      'touchstart',
      handleTouchStart as unknown as EventListener,
      { passive: false }
    )
    window.addEventListener(
      'touchmove',
      handleTouchMove as unknown as EventListener,
      { passive: false }
    )
    window.addEventListener('touchend', handleTouchEnd as EventListener)

    return () => {
      window.removeEventListener(
        'wheel',
        handleWheel as unknown as EventListener
      )
      window.removeEventListener('scroll', handleScroll as EventListener)
      window.removeEventListener(
        'touchstart',
        handleTouchStart as unknown as EventListener
      )
      window.removeEventListener(
        'touchmove',
        handleTouchMove as unknown as EventListener
      )
      window.removeEventListener('touchend', handleTouchEnd as EventListener)
    }
  }, [scrollProgress, mediaFullyExpanded, touchStartY])

  useEffect(() => {
    const checkIfMobile = (): void => {
      setIsMobileState(window.innerWidth < 768)
    }

    checkIfMobile()
    window.addEventListener('resize', checkIfMobile)

    return () => window.removeEventListener('resize', checkIfMobile)
  }, [])

  const mediaWidth = 300 + scrollProgress * (isMobileState ? 650 : 1250)
  const mediaHeight = 400 + scrollProgress * (isMobileState ? 200 : 400)
  const textTranslateX = scrollProgress * (isMobileState ? 180 : 150)

  const firstWord = title ? title.split(' ')[0] : ''
  const restOfTitle = title ? title.split(' ').slice(1).join(' ') : ''

  return (
    <div
      ref={sectionRef}
      className='transition-colors duration-700 ease-in-out overflow-x-hidden'
    >
      <section className='relative flex flex-col items-center justify-start min-h-[100dvh]'>
        <div className='relative w-full flex flex-col items-center min-h-[100dvh]'>
          {bgImageSrc && (
            <motion.div
              className='absolute inset-0 z-0 h-full'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 - scrollProgress }}
              transition={{ duration: 0.1 }}
            >
              <Image
                src={bgImageSrc}
                alt='Background'
                width={1920}
                height={1080}
                className='w-screen h-screen'
                style={{ objectFit: 'cover', objectPosition: 'center' }}
                priority
              />
              <div className='absolute inset-0 bg-black/10' />
            </motion.div>
          )}

          <div className='container mx-auto flex flex-col items-center justify-start relative z-10'>
            <div className='flex flex-col items-center justify-center w-full h-[100dvh] relative'>
              <div
                className='absolute z-0 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 transition-none'
                style={{
                  width: `${mediaWidth}px`,
                  height: `${mediaHeight}px`,
                  maxWidth: '95vw',
                  maxHeight: '85vh',
                  // Soft radial mask blends the image edges into the page background
                  // instead of cutting them with a hard rectangle/border.
                  WebkitMaskImage:
                    'radial-gradient(ellipse 75% 75% at center, #000 50%, transparent 100%)',
                  maskImage:
                    'radial-gradient(ellipse 75% 75% at center, #000 50%, transparent 100%)',
                }}
              >
                {mediaType === 'video' ? (
                  mediaSrc.includes('youtube.com') ? (
                    <div className='relative w-full h-full pointer-events-none'>
                      <iframe
                        width='100%'
                        height='100%'
                        src={
                          mediaSrc.includes('embed')
                            ? mediaSrc +
                              (mediaSrc.includes('?') ? '&' : '?') +
                              'autoplay=1&mute=1&loop=1&controls=0&showinfo=0&rel=0&disablekb=1&modestbranding=1'
                            : mediaSrc.replace('watch?v=', 'embed/') +
                              '?autoplay=1&mute=1&loop=1&controls=0&showinfo=0&rel=0&disablekb=1&modestbranding=1&playlist=' +
                              mediaSrc.split('v=')[1]
                        }
                        className='w-full h-full rounded-xl'
                        frameBorder='0'
                        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                        allowFullScreen
                      />
                      <div
                        className='absolute inset-0 z-10'
                        style={{ pointerEvents: 'none' }}
                      />
                      <motion.div
                        className='absolute inset-0 bg-black/30 rounded-xl'
                        initial={{ opacity: 0.7 }}
                        animate={{ opacity: 0.5 - scrollProgress * 0.3 }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  ) : (
                    <div className='relative w-full h-full pointer-events-none'>
                      <video
                        src={mediaSrc}
                        poster={posterSrc}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload='auto'
                        className='w-full h-full object-cover rounded-xl'
                        controls={false}
                        disablePictureInPicture
                        disableRemotePlayback
                      />
                      <div
                        className='absolute inset-0 z-10'
                        style={{ pointerEvents: 'none' }}
                      />
                      <motion.div
                        className='absolute inset-0 bg-black/30 rounded-xl'
                        initial={{ opacity: 0.7 }}
                        animate={{ opacity: 0.5 - scrollProgress * 0.3 }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  )
                ) : (
                  <div className='relative w-full h-full'>
                    <Image
                      src={mediaSrc}
                      alt={title || 'Media content'}
                      width={1280}
                      height={720}
                      className='w-full h-full object-cover'
                    />
                    {/* Softer dark wash + warm gold tint to harmonise with the brand */}
                    <motion.div
                      className='absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/60 via-[#0A0A0A]/20 to-[#0A0A0A]/70 mix-blend-multiply'
                      initial={{ opacity: 0.8 }}
                      animate={{ opacity: 0.85 - scrollProgress * 0.4 }}
                      transition={{ duration: 0.2 }}
                    />
                    <motion.div
                      className='absolute inset-0 bg-gold/10 mix-blend-overlay'
                      initial={{ opacity: 0.4 }}
                      animate={{ opacity: 0.5 - scrollProgress * 0.3 }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                )}

                <div className='flex flex-col items-center text-center relative z-10 mt-4 transition-none'>
                  {date && (
                    <p
                      className='text-2xl text-gold-light'
                      style={{ transform: `translateX(-${textTranslateX}vw)` }}
                    >
                      {date}
                    </p>
                  )}
                  {scrollToExpand && (
                    <p
                      className='text-gold-light font-medium text-center'
                      style={{ transform: `translateX(${textTranslateX}vw)` }}
                    >
                      {scrollToExpand}
                    </p>
                  )}
                </div>
              </div>

              <div
                className={`flex items-center justify-center text-center gap-2 sm:gap-4 w-full relative z-10 transition-none flex-col ${
                  textBlend ? 'mix-blend-difference' : 'mix-blend-normal'
                }`}
              >
                {/* Each word is wrapped in a motion.div that runs a one-time spring entry
                    from off-screen; the inner h2 keeps the scroll-driven translateX. */}
                <motion.div
                  initial={{ x: 220, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                  transition={{
                    type: 'spring',
                    stiffness: 70,
                    damping: 18,
                    mass: 0.9,
                    delay: 0.15,
                    opacity: { duration: 1.1, ease: 'easeOut', delay: 0.15 },
                    filter:  { duration: 1.0, ease: 'easeOut', delay: 0.15 },
                  }}
                >
                  <h2
                    className='text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold text-gold leading-[0.95] tracking-tight drop-shadow-[0_8px_32px_rgba(201,168,108,0.35)]'
                    style={{ transform: `translateX(-${textTranslateX}vw)` }}
                  >
                    {firstWord}
                  </h2>
                </motion.div>

                <motion.div
                  initial={{ x: -220, opacity: 0, filter: 'blur(8px)' }}
                  animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                  transition={{
                    type: 'spring',
                    stiffness: 70,
                    damping: 18,
                    mass: 0.9,
                    delay: 0.3,
                    opacity: { duration: 1.1, ease: 'easeOut', delay: 0.3 },
                    filter:  { duration: 1.0, ease: 'easeOut', delay: 0.3 },
                  }}
                >
                  <h2
                    className='text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold text-center text-gold leading-[0.95] tracking-tight drop-shadow-[0_8px_32px_rgba(201,168,108,0.35)]'
                    style={{ transform: `translateX(${textTranslateX}vw)` }}
                  >
                    {restOfTitle}
                  </h2>
                </motion.div>
              </div>
            </div>

            <motion.section
              className='flex flex-col w-full px-8 py-10 md:px-16 lg:py-20'
              initial={{ opacity: 0 }}
              animate={{ opacity: showContent ? 1 : 0 }}
              transition={{ duration: 0.7 }}
            >
              {children}
            </motion.section>
          </div>
        </div>
      </section>
    </div>
  )
}

export default ScrollExpandMedia
