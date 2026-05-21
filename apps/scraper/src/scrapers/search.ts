import { newPage, sleep } from '../browser.js'

export interface MeetStub {
  athleticNetId: string
  name: string
  date: string      // ISO date string
  location: string
  state: string
  level: 'hs' | 'college' | 'open'
  division: string | null
  rsUrl: string | null
  hasResults: boolean
}

export async function searchRecentMeets(
  state: string,
  daysBack = 14,
): Promise<MeetStub[]> {
  const { page, context } = await newPage()

  try {
    // Navigate to athletic.net so Cloudflare's JS challenge runs and sets clearance cookies
    console.log('  Loading athletic.net to clear Cloudflare...')
    await page.goto('https://www.athletic.net/events', { waitUntil: 'networkidle', timeout: 60_000 })
    // Wait for the actual page — CF challenge redirects, so networkidle fires after the real page loads
    await sleep(2000)

    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - daysBack)

    const body = {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      levelMask: 0,
      sportMask: 0,
      country: 'US',
      state: state.toUpperCase(),
      distanceKM: 0,
      filterTerm: '',
      location: '',
    }

    console.log(`  Searching ${body.start} to ${body.end} in ${state}`)

    // Run fetch from inside the browser context — CF clearance cookies are already set
    const result = await page.evaluate(async (reqBody) => {
      try {
        const userRes = await fetch('/api/v1/SignedInUser/GetSignedInUser', {
          headers: { 'accept': 'application/json', 'anet-appinfo': 'web:web:0:240' },
        })
        const user = userRes.ok ? await userRes.json() as Record<string, unknown> : {}
        const token = user.jwtUserRolesSiteWide as string | undefined

        const headers: Record<string, string> = {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/json',
          'anet-appinfo': 'web:web:0:240',
        }
        if (token) headers['anet-site-roles-token'] = token

        const res = await fetch('/api/v1/Event/Events', {
          method: 'POST',
          headers,
          body: JSON.stringify(reqBody),
        })
        if (!res.ok) return { error: res.status, body: await res.text() }
        return { data: await res.json() }
      } catch (err) {
        return { error: -1, body: String(err) }
      }
    }, body)

    if ('error' in result) {
      console.log(`  Events API returned ${(result as { error: number; body: string }).error}: ${(result as { error: number; body: string }).body?.slice(0, 200)}`)
      return []
    }

    const json = (result as { data: Record<string, unknown> }).data
    console.log(`  Response keys: ${Object.keys(json).join(', ')}`)

    const firstList = Object.values(json).find((v) => Array.isArray(v)) as unknown[] | undefined
    if (firstList?.length) {
      const first = firstList[0] as Record<string, unknown>
      console.log(`  First item keys: ${Object.keys(first).join(', ')}`)
      console.log(`  First item: ${JSON.stringify(first).slice(0, 300)}`)
      console.log(`  rsUrl value: ${JSON.stringify(first.rsUrl ?? first.RsUrl ?? 'NOT FOUND')}`)
    }

    const events = parseEventsResponse(json, state)
    return events.filter((m) => {
      const d = new Date(m.date)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - daysBack)
      return d >= cutoff
    })
  } finally {
    await page.close()
  }
}

function parseEventsResponse(json: Record<string, unknown>, state: string): MeetStub[] {
  const stubs: MeetStub[] = []

  const list =
    (json.events as unknown[]) ??
    (json.Events as unknown[]) ??
    (json.meets as unknown[]) ??
    (json.Meets as unknown[]) ??
    (json.results as unknown[]) ??
    (json.Results as unknown[]) ??
    (json.data as unknown[]) ??
    (Array.isArray(json) ? json as unknown[] : null) ??
    (Object.values(json).find((v) => Array.isArray(v)) as unknown[] | undefined) ??
    []

  for (const raw of list) {
    const m = raw as Record<string, unknown>
    const stub = parseMeetStub(m, state)
    if (stub) stubs.push(stub)
  }

  return stubs
}

function parseMeetStub(raw: Record<string, unknown>, state: string): MeetStub | null {
  try {
    const id = String(
      raw.IDMeet ?? raw.meetId ?? raw.MeetId ?? raw.meetID ?? raw.MeetID ??
      raw.eventId ?? raw.EventId ?? raw.id ?? raw.Id ?? ''
    )
    const name = String(
      raw.MeetName ?? raw.meetName ?? raw.eventName ?? raw.EventName ??
      raw.name ?? raw.Name ?? ''
    )
    const date = String(
      raw.StartDate ?? raw.startDate ?? raw.date ?? raw.Date ??
      raw.eventDate ?? raw.EventDate ?? ''
    )
    const location = String(
      raw.LocationName ?? raw.City ?? raw.location ?? raw.Location ??
      raw.venue ?? raw.Venue ?? raw.city ?? ''
    )
    const divisionRaw = String(raw.LevelMask ?? raw.division ?? raw.Division ?? raw.level ?? raw.Level ?? '').toLowerCase()

    if (!id || !name) return null

    const rsUrlRaw = raw.rsUrl ?? raw.RsUrl ?? raw.resultsUrl ?? raw.ResultsUrl ?? null
    const rsUrl = rsUrlRaw
      ? (String(rsUrlRaw).startsWith('http') ? String(rsUrlRaw) : `https://www.athletic.net${String(rsUrlRaw)}`)
      : null

    return {
      athleticNetId: id,
      name,
      date: normalizeDate(date),
      location,
      state,
      level: inferLevel(divisionRaw),
      division: inferDivision(divisionRaw),
      rsUrl,
      hasResults: Boolean(raw.HasResults ?? raw.hasResults ?? false),
    }
  } catch {
    return null
  }
}

function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function inferLevel(division: string): 'hs' | 'college' | 'open' {
  if (division.includes('college') || division.includes('ncaa') || division.includes('d1') || division.includes('d2') || division.includes('d3')) return 'college'
  if (division.includes('open') || division.includes('club')) return 'open'
  return 'hs'
}

function inferDivision(division: string): string | null {
  const match = division.match(/\b(1a|2a|3a|4a|5a|d1|d2|d3|d-i|d-ii|d-iii)\b/i)
  return match ? match[1].toUpperCase() : null
}
