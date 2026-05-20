import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { MeetSummary } from '@runmob/shared'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { RatingBadge } from '../components/RatingBadge'
import { Spinner } from '../components/Spinner'

export function HomePage() {
  const [meets, setMeets] = useState<MeetSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.meets.list()
      .then(setMeets)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-2xl font-bold mb-4 text-text-primary">Recent Meets</h2>
        {meets.length === 0 ? (
          <p className="text-text-secondary text-sm">No meets yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {meets.map((meet) => <MeetCard key={meet.id} meet={meet} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function MeetCard({ meet }: { meet: MeetSummary }) {
  return (
    <Link
      to={`/meet/${meet.id}`}
      className="bg-surface rounded-xl p-4 border border-white/5 hover:border-accent/30 hover:bg-surface-2 transition-all group block"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight truncate">
            {meet.name}
          </h3>
          <p className="text-text-secondary text-xs mt-0.5">{formatDate(meet.date)}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <span className="bg-surface-2 text-text-secondary text-[10px] px-1.5 py-0.5 rounded font-medium">
            {meet.level.toUpperCase()}
          </span>
          {meet.division && (
            <span className="bg-surface-2 text-text-secondary text-[10px] px-1.5 py-0.5 rounded font-medium">
              {meet.division}
            </span>
          )}
        </div>
      </div>

      <p className="text-text-secondary text-xs mb-3">{meet.location}</p>

      <div className="flex items-center justify-between text-xs text-text-secondary">
        <div className="flex gap-3">
          <span>{meet.athleteCount} athletes</span>
          <span>{meet.eventCount} events</span>
        </div>
        {meet.topRating !== undefined && meet.topRating !== null && (
          <div className="flex items-center gap-1.5">
            <span>Top:</span>
            <RatingBadge rating={meet.topRating} size="sm" />
          </div>
        )}
      </div>
    </Link>
  )
}
