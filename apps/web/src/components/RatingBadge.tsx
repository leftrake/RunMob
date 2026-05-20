import { getRatingColor } from '@runmob/shared'

interface Props {
  rating: number
  size?: 'sm' | 'md' | 'lg'
}

export function RatingBadge({ rating, size = 'md' }: Props) {
  const color = getRatingColor(rating)
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5 min-w-[2rem]',
    md: 'text-sm px-2 py-0.5 min-w-[2.5rem]',
    lg: 'text-base px-2.5 py-1 min-w-[3rem]',
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded font-mono font-medium tabular-nums ${sizeClasses[size]}`}
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {rating.toFixed(1)}
    </span>
  )
}
