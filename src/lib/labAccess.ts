// Emails allowed into the experimental "מעבדה" tools (auto-mapping lab, etc.).
// Add an email here to grant access — gating in both the nav (layout.tsx) and
// the page-level guards reads from this single list. Compared case-insensitively.
export const LAB_EMAILS = [
  'ninioori@gmail.com',
  'eden00076@gmail.com',
]

export function hasLabAccess(email?: string | null): boolean {
  return !!email && LAB_EMAILS.includes(email.toLowerCase())
}
