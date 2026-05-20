import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type SearchAthleteResult, type SearchMeetResult } from '../lib/api'
import { formatShortDate } from '../lib/utils'
import { Spinner } from '../components/Spinner'

interface SearchResults {
  athletes: SearchAthleteResult[]
  meets: SearchMeetResult[]
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    setQuery(q)
    if (q.length >= 2) {
      setLoading(true)
      api.search.query(q)
        .then(setResults)
        .finally(() => setLoading(false))
    } else {
      setResults(null)
    }
  }, [searchParams])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchParams(val.trim() ? { q: val.trim() } : {})
    }, 300)
  }

  const hasResults = results && (results.athletes.length > 0 || results.meets.length > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-text-primary mb-4">Search</h1>
        <input
          value={query}
          onChange={handleChange}
          placeholder="Search athletes, meets, schools…"
          autoFocus
          className="w-full bg-surface text-text-primary placeholder:text-text-secondary text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-accent/30 border border-white/5"
        />
      </div>

      {loading && <Spinner />}

      {!loading && query.length >= 2 && !hasResults && (
        <p className="text-text-secondary text-sm text-center py-8">No results for &ldquo;{query}&rdquo;</p>
      )}

      {!loading && results && results.athletes.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Athletes</h2>
          <div className="bg-surface rounded-xl divide-y divide-white/5 overflow-hidden">
            {results.athletes.map((a) => (
              <Link
                key={a.id}
                to={`/athlete/${a.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors group"
              >
                <div>
                  <p className="text-text-primary text-sm font-medium group-hover:text-accent transition-colors">{a.name}</p>
                  <p className="text-text-secondary text-xs">{a.school} &bull; {a.state} &bull; Class of {a.gradYear}</p>
                </div>
                <span className="text-text-secondary text-xs">{a.gender === 'M' ? 'Men' : 'Women'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && results && results.meets.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Meets</h2>
          <div className="bg-surface rounded-xl divide-y divide-white/5 overflow-hidden">
            {results.meets.map((m) => (
              <Link
                key={m.id}
                to={`/meet/${m.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors group"
              >
                <div>
                  <p className="text-text-primary text-sm font-medium group-hover:text-accent transition-colors">{m.name}</p>
                  <p className="text-text-secondary text-xs">{m.location} &bull; {formatShortDate(m.date)}</p>
                </div>
                <span className="text-text-secondary text-xs uppercase">{m.level}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
