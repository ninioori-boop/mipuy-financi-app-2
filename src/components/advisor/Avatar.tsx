// Shared initials avatar for the advisor screens — a soft gold-gradient circle.

const SIZES = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-12 w-12 text-sm',
} as const

/** Initials from a name — first letter of the first two words. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof SIZES }) {
  return (
    <span
      className={`${SIZES[size]} shrink-0 rounded-full grid place-items-center font-semibold text-gold
        bg-gradient-to-br from-gold/25 to-gold/5 border border-gold/20`}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
