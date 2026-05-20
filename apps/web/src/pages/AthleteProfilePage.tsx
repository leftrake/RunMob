import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { Athlete } from '@runmob/shared'
import { api } from '../lib/api'
import { formatShortDate } from '../lib/utils'
import { RatingBadge } from '../components/RatingBadge'
import { Spinner } from '../components/Spinner'

interface AthleteWithResults extends Athlete {
  results: AthleteResultWithMeet[]
}

interface AthleteResultWithMeet {
  id: string
  meetId: string
  meetName: string
  meetDate: string
  eventName: string
  place: number
  displayTime: string
  rating: number
  ratingLabel: string
  prAtMeet: boolean
  seasonBestAtMeet: boolean
}

export function AthleteProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [athlete, setAthlete] = useState<AthleteWithResults | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.athletes.get(id)
      .then((data) => setAthlete(data as unknown as AthleteWithResults))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spinner />
  if (error || !athlete) return <div className="text-text-secondary text-center py-16">{error ?? 'Athlete not found'}</div>

  const seasonBests = athlete.seasonBests as Record<string, string>
  const allTimePRs = athlete.allTimePRs as Record<string, string>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-4xl font-bold text-text-primary">{athlete.name}</h1>
            <p className="text-text-secondary text-sm mt-1">
              {athlete.school} &bull; {athlete.state} &bull; Class of {athlete.gradYear}
            </p>
          </div>
          <span className="bg-surface-2 text-text-secondary text-sm px-3 py-1 rounded-lg">
            {athlete.gender === 'M' ? 'Men' : 'Women'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {(athlete.events as string[]).map((event) => (
            <span key={event} className="bg-accent/10 text-accent text-xs px-2.5 py-1 rounded-full font-medium">
              {event}
            </span>
          ))}
        </div>
      </div>

      {/* Season bests */}
      {Object.keys(seasonBests).length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Season Bests</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(seasonBests).map(([event, time]) => (
              <div key={event} className="bg-surface rounded-xl p-4">
                <p className="text-text-secondary text-xs mb-1">{event}</p>
                <p className="font-mono text-text-primary text-xl font-medium">{time}</p>
                {allTimePRs[event] && allTimePRs[event] !== time && (
                  <p className="text-text-secondary text-xs mt-1">PR: <span className="font-mono">{allTimePRs[event]}</span></p>
                )}
                {allTimePRs[event] === time && (
                  <p className="text-accent text-xs mt-1 font-medium">All-time PR</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Result history */}
      {athlete.results.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Results</h2>
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="divide-y divide-white/5">
              {athlete.results.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4 flex-wrap">
                  <RatingBadge rating={r.rating} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/meet/${r.meetId}`}
                        className="text-sm text-text-primary hover:text-accent transition-colors font-medium truncate"
                      >
                        {r.meetName}
                      </Link>
                      <span className="text-text-secondary text-xs">{r.eventName}</span>
                    </div>
                    <p className="text-text-secondary text-xs">{formatShortDate(r.meetDate)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-text-primary text-sm">{r.displayTime}</p>
                    <div className="flex gap-1 justify-end mt-0.5">
                      {r.prAtMeet && <span className="text-[10px] bg-accent/20 text-accent px-1 rounded font-bold">PR</span>}
                      {r.seasonBestAtMeet && !r.prAtMeet && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1 rounded font-bold">SB</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
