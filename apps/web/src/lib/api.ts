const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  meets: {
    list: () => get<import('@runmob/shared').MeetSummary[]>('/meets'),
    get: (id: string) => get<import('@runmob/shared').Meet>(`/meets/${id}`),
  },
  athletes: {
    get: (id: string) => get<import('@runmob/shared').Athlete>(`/athletes/${id}`),
  },
  search: {
    query: (q: string) =>
      get<{ athletes: SearchAthleteResult[]; meets: SearchMeetResult[] }>(`/search?q=${encodeURIComponent(q)}`),
  },
}

export interface SearchAthleteResult {
  id: string
  name: string
  school: string
  state: string
  gender: string
  gradYear: number
}

export interface SearchMeetResult {
  id: string
  name: string
  date: string
  location: string
  level: string
  state: string
}
