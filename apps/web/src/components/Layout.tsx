import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'

export function Layout() {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`)
      setQuery('')
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="bg-surface border-b border-white/5 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
          <NavLink to="/" className="font-display text-2xl font-bold text-accent tracking-tight shrink-0">
            RUNMOB
          </NavLink>

          <form onSubmit={handleSearch} className="flex-1 max-w-sm">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search athletes, meets…"
              className="w-full bg-surface-2 text-text-primary placeholder:text-text-secondary text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-accent/40"
            />
          </form>

          <nav className="hidden sm:flex items-center gap-1 ml-auto">
            <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>Home</NavLink>
            <NavLink to="/search" className={({ isActive }) => navClass(isActive)}>Search</NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

function navClass(isActive: boolean) {
  return `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'
  }`
}
