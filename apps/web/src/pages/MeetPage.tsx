import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { Meet, MeetEvent, AthleteResult } from '@runmob/shared'
import { getRatingLabel } from '@runmob/shared'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { RatingBadge } from '../components/RatingBadge'
import { Spinner } from '../components/Spinner'

export function MeetPage() {
  const { id } = useParams<{ id: string }>()
  const [meet, setMeet] = useState<Meet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<'M' | 'F' | 'all'>('all')

  useEffect(() => {
    if (!id) return
    api.meets.get(id)
      .then((data) => {
        setMeet(data)
        setSelectedEventId(data.events[0]?.id ?? null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spinner />
  if (error || !meet) return <div className="text-text-secondary text-center py-16">{error ?? 'Meet not found'}</div>

  const allResults = meet.events.flatMap((e) => e.results)
  const topResult = [...allResults].sort((a, b) => b.rating - a.rating)[0]
  const topResultAthleteName = topResult
    ? meet.events.flatMap((e) => e.results).find((r) => r.id === topResult.id)?.athleteName
    : undefined

  const filteredEvents = genderFilter === 'all'
    ? meet.events
    : meet.events.filter((e) => e.gender === genderFilter)

  const activeEvent = filteredEvents.find((e) => e.id === selectedEventId) ?? filteredEvents[0]

  return (
    <div className="space-y-6">
      {/* Meet header */}
      <div className="bg-surface rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold text-text-primary leading-tight">{meet.name}</h1>
            <p className="text-text-secondary text-sm mt-1">
              {formatDate(meet.date)} &bull; {meet.location}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Chip>{meet.level.toUpperCase()}</Chip>
            {meet.division && <Chip>{meet.division}</Chip>}
            <Chip>{meet.state}</Chip>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-6 pt-1">
          <Stat label="Athletes" value={String(new Set(allResults.map((r) => r.athleteId)).size)} />
          <Stat label="Events" value={String(meet.events.length)} />
          {topResult && (
            <Stat
              label="Top Rating"
              value={
                <span className="flex items-center gap-1.5">
                  <RatingBadge rating={topResult.rating} size="sm" />
                  <span className="text-text-secondary text-xs truncate max-w-[120px]">{topResultAthleteName}</span>
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* Meet MVP card */}
      {topResult && topResultAthleteName && (
        <MvpCard result={topResult} athleteName={topResultAthleteName} eventName={
          meet.events.find((e) => e.results.some((r) => r.id === topResult.id))?.eventName ?? ''
        } />
      )}

      {/* Gender filter + event tabs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {(['all', 'M', 'F'] as const).map((g) => (
            <button
              key={g}
              onClick={() => {
                setGenderFilter(g)
                setSelectedEventId(null)
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                genderFilter === g
                  ? 'bg-accent text-black'
                  : 'bg-surface-2 text-text-secondary hover:text-text-primary'
              }`}
            >
              {g === 'all' ? 'All' : g === 'M' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {filteredEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => setSelectedEventId(event.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                (activeEvent?.id === event.id)
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-surface text-text-secondary border border-white/5 hover:text-text-primary'
              }`}
            >
              {event.eventName}
              <span className="text-text-secondary text-xs ml-1">{event.gender}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Event results */}
      {activeEvent && <EventResultsTable event={activeEvent} />}
    </div>
  )
}

function MvpCard({ result, athleteName, eventName }: { result: AthleteResult; athleteName: string; eventName: string }) {
  return (
    <div className="bg-surface rounded-xl p-4 border border-accent/20">
      <p className="text-text-secondary text-xs font-medium uppercase tracking-widest mb-2">Meet MVP</p>
      <div className="flex items-center gap-4">
        <RatingBadge rating={result.rating} size="lg" />
        <div>
          <Link
            to={`/athlete/${result.athleteId}`}
            className="font-display text-xl font-bold text-text-primary hover:text-accent transition-colors"
          >
            {athleteName}
          </Link>
          <p className="text-text-secondary text-sm">
            {eventName} &bull; <span className="font-mono">{result.displayTime}</span>
            {result.prAtMeet && <span className="ml-2 text-accent text-xs font-medium">PR</span>}
          </p>
          <p className="text-text-secondary text-xs">{getRatingLabel(result.rating)}</p>
        </div>
      </div>
    </div>
  )
}

const ROUND_ORDER = ['Finals', 'Prelims']

function EventResultsTable({ event }: { event: MeetEvent }) {
  const byRound = event.results.reduce<Record<string, typeof event.results>>((acc, r) => {
    ;(acc[r.round] ??= []).push(r)
    return acc
  }, {})

  const rounds = [
    ...ROUND_ORDER.filter((r) => byRound[r]),
    ...Object.keys(byRound).filter((r) => !ROUND_ORDER.includes(r)),
  ]
  const multipleRounds = rounds.length > 1

  return (
    <div className="bg-surface rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <h2 className="font-display text-lg font-semibold text-text-primary">
          {event.eventName} <span className="text-text-secondary font-normal text-sm">— {event.gender === 'M' ? 'Men' : 'Women'}</span>
        </h2>
      </div>

      {rounds.map((round) => (
        <div key={round}>
          {multipleRounds && (
            <div className="px-4 py-2 bg-surface-2/40 border-b border-white/5 text-text-secondary text-xs font-semibold uppercase tracking-widest">
              {round}
            </div>
          )}
          <div className="divide-y divide-white/5">
            <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-x-3 px-4 py-2 text-text-secondary text-xs font-medium">
              <span>#</span>
              <span>Athlete</span>
              <span>Time</span>
              <span>Rating</span>
            </div>
            {byRound[round].map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultRow({ result }: { result: AthleteResult }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[2rem_1fr_auto_auto] gap-x-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors group"
      >
        <span className="text-text-secondary text-sm tabular-nums">{result.place}</span>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/athlete/${result.athleteId}`}
              className="font-medium text-text-primary hover:text-accent transition-colors text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {result.athleteName}
            </Link>
            {result.prAtMeet && (
              <span className="text-[10px] font-bold bg-accent/20 text-accent px-1.5 py-0.5 rounded">PR</span>
            )}
            {result.seasonBestAtMeet && !result.prAtMeet && (
              <span className="text-[10px] font-bold bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">SB</span>
            )}
          </div>
          <p className="text-text-secondary text-xs truncate">{result.teamName}</p>
        </div>

        <span className="font-mono text-text-primary tabular-nums text-sm self-center">{result.displayTime}</span>
        <div className="self-center">
          <RatingBadge rating={result.rating} size="sm" />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 bg-surface-2/50">
          <div className="flex gap-4 text-xs text-text-secondary">
            <span>Rating: <span className="text-text-primary font-medium">{getRatingLabel(result.rating)}</span></span>
            <span>Place: <span className="text-text-primary font-medium">{result.place}</span></span>
            {result.prAtMeet && <span className="text-accent font-medium">Personal Record</span>}
            {result.seasonBestAtMeet && !result.prAtMeet && <span className="text-yellow-400 font-medium">Season Best</span>}
          </div>
        </div>
      )}
    </>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-surface-2 text-text-secondary text-xs px-2 py-1 rounded-md font-medium">
      {children}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-text-secondary text-xs">{label}</p>
      <p className="text-text-primary font-medium text-sm">{value}</p>
    </div>
  )
}
