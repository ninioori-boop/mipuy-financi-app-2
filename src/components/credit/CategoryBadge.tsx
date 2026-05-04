import { CATEGORY_ICONS } from '@/lib/constants'

interface Props {
  category: string
  className?: string
}

export function CategoryBadge({ category, className = '' }: Props) {
  const icon = CATEGORY_ICONS[category] ?? '📦'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface border border-line text-txt whitespace-nowrap ${className}`}
    >
      <span>{icon}</span>
      <span>{category}</span>
    </span>
  )
}
