import Script from 'next/script'

/**
 * Google Analytics 4 — cookieless mode.
 *
 * Consent Mode v2 with every storage type denied BEFORE config runs, so
 * gtag.js never sets _ga cookies — GA still receives (modeled) page views.
 * This is what keeps the CookieBanner promise ("אין שימוש בעוגיות פרסום
 * או מעקב") literally true; do not flip these to 'granted' without also
 * rewording the banner and the privacy policy.
 *
 * Inert until NEXT_PUBLIC_GA_MEASUREMENT_ID is set (Vercel env var), so
 * local dev and preview builds send nothing unless opted in.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export function GoogleAnalytics() {
  if (!GA_ID) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied'
          });
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  )
}
