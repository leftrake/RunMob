export interface MeetStub {
  athleticNetId: string
  name: string
  date: string      // ISO date string
  location: string
  state: string
  level: 'hs' | 'college' | 'open'
  division: string | null
}

const BASE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'anet-appinfo': 'web:web:0:240',
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'origin': 'https://www.athletic.net',
  'referer': 'https://www.athletic.net/events',
}

async function getSiteRolesToken(): Promise<string | null> {
  try {
    const res = await fetch('https://www.athletic.net/api/v1/SignedInUser/GetSignedInUser', {
      headers: BASE_HEADERS,
    })
    if (!res.ok) {
      console.log(`  GetSignedInUser returned ${res.status}`)
      return null
    }
    const json = await res.json() as Record<string, unknown>
    const token = json.jwtUserRolesSiteWide as string | null
    console.log(`  Got site roles token: ${token ? 'yes' : 'no'}`)
    return token ?? null
  } catch (err) {
    console.log(`  Failed to get site roles token: ${err}`)
    return null
  }
}

export async function searchRecentMeets(
  state: string,
  daysBack = 14,
): Promise<MeetStub[]> {
  const token = await getSiteRolesToken()
  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (token) headers['anet-site-roles-token'] = token

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

  const res = await fetch('https://www.athletic.net/api/v1/Event/Events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.log(`  Events API returned ${res.status}: ${await res.text().catch(() => '')}`)
    return []
  }

  const json = await res.json() as Record<string, unknown>
  console.log(`  Response keys: ${Object.keys(json).join(', ')}`)

  // Log first item to understand structure
  const firstList = Object.values(json).find((v) => Array.isArray(v)) as unknown[] | undefined
  if (firstList?.length) {
    console.log(`  First item keys: ${Object.keys(firstList[0] as object).join(', ')}`)
    console.log(`  First item: ${JSON.stringify(firstList[0]).slice(0, 300)}`)
  }

  const events = parseEventsResponse(json, state)
  return events.filter((m) => {
    const d = new Date(m.date)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)
    return d >= cutoff
  })
}

function parseEventsResponse(json: Record<string, unknown>, state: string): MeetStub[] {
  const stubs: MeetStub[] = []

  // Try all likely top-level array fields
  const list =
    (json.events as unknown[]) ??
    (json.Events as unknown[]) ??
    (json.meets as unknown[]) ??
    (json.Meets as unknown[]) ??
    (json.results as unknown[]) ??
    (json.Results as unknown[]) ??
    (json.data as unknown[]) ??
    (Array.isArray(json) ? json as unknown[] : null) ??
    // Sometimes the list is the first array value in the object
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
    // Skip meets with no results posted yet
    if (raw.HasResults === 0 || raw.hasResults === 0) return null

    const id = String(raw.IDMeet ?? raw.meetId ?? raw.MeetId ?? raw.id ?? '')
    const name = String(raw.MeetName ?? raw.meetName ?? raw.name ?? '')
    const date = String(raw.StartDate ?? raw.startDate ?? raw.date ?? '')
    const city = String(raw.City ?? raw.city ?? '')
    const locationName = String(raw.LocationName ?? raw.locationName ?? '')
    const location = [locationName, city].filter(Boolean).join(', ')
    const levelMask = Number(raw.LevelMask ?? raw.levelMask ?? 0)

    if (!id || !name) return null

    return {
      athleticNetId: id,
      name,
      date: normalizeDate(date),
      location,
      state,
      level: inferLevelFromMask(levelMask),
      division: null,
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

function inferLevelFromMask(mask: number): 'hs' | 'college' | 'open' {
  if (mask & 4) return 'hs'      // bit 2 = high school
  if (mask & 8) return 'college' // bit 3 = college
  return 'open'
}

function stateToSlug(state: string): string {
  const map: Record<string, string> = {
    NC: 'north-carolina', VA: 'virginia', SC: 'south-carolina',
    GA: 'georgia', TN: 'tennessee', FL: 'florida', TX: 'texas',
    CA: 'california', NY: 'new-york', OH: 'ohio', PA: 'pennsylvania',
  }
  return map[state.toUpperCase()] ?? state.toLowerCase()
}

// suppress unused warning — stateToSlug may be used in future URL-based fallback
void stateToSlug
