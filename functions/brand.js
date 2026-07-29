// Brand identity for outbound email (Cloud Functions can't import the app's
// TypeScript, so this mirrors src/lib/brand.ts — change both together).
//
// White-label next step: resolve the brand per practice (practices/{practiceId})
// instead of this single constant, so each licensed firm's invites go out under
// its own name, domain and verified Resend sender.
const BRAND = {
  nameHe: "הכלכלן של הבית",
  wordmarkEn: "THE HOME ECONOMIST",
  appUrl: "https://app.orimipuy.com",
  // orimipuy.com is verified in Resend (DKIM/SPF/MX in Route 53, 2026-07-21).
  mailFrom: "הכלכלן של הבית <invite@orimipuy.com>",
  gold: "#C9A86C",
};

module.exports = { BRAND };
