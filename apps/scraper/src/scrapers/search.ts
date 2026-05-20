import { newPage, sleep } from '../browser.js'

export interface MeetStub {
  athleticNetId: string
  name: string
  date: string      // ISO date string
  location: string
  state: string
  level: 'hs' | 'college' | 'open'
  division: string | null
}

// AthleticNet meet search API — intercepted from browser network tab.
// Returns meets for a state within the past N days.
export async function searchRecentMeets(
  state: string,
  daysBack = 14,
): Promise<MeetStub[]> {
  const { page, context } = await newPage()
  const meets: MeetStub[] = []

  try {
    const captured: MeetStub[] = []

    // Intercept the JSON search API AthleticNet's SPA calls internally
    await page.route('**/api/v1/Meet/GetMeetList**', async (route) => {
      const response = await route.fetch()
      const json = await response.json().catch(() => null)
      if (json?.meetList) {
        for (const m of json.meetList) {
          const stub = parseMeetStub(m, state)
          if (stub) captured.push(stub)
        }
      }
      await route.fulfill({ response })
    })

    // Navigate to AthleticNet state TF meet list — this triggers the API call above
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)

    await page.goto(
      `https://www.athletic.net/TrackAndField/State/${encodeURIComponent(state)}/Meets`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    )

    await sleep(1000)
    meets.push(...captured)

    // If interception didn't fire, fall back to DOM parsing
    if (meets.length === 0) {
      const domMeets = await parseMeetListFromDom(page, state)
      meets.push(...domMeets)
    }
  } finally {
    await context.close()
  }

  return meets.filter((m) => {
    const d = new Date(m.date)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)
    return d >= cutoff
  })
}

function parseMeetStub(raw: Record<string, unknown>, state: string): MeetStub | null {
  try {
    const id = String(raw.MeetID ?? raw.meetId ?? raw.id ?? '')
    const name = String(raw.MeetName ?? raw.meetName ?? raw.name ?? '')
    const date = String(raw.StartDate ?? raw.startDate ?? raw.date ?? '')
    const location = String(raw.Location ?? raw.location ?? raw.venue ?? '')
    const divisionRaw = String(raw.Division ?? raw.division ?? '').toLowerCase()

    if (!id || !name) return null

    return {
      athleticNetId: id,
      name,
      date: normalizeDate(date),
      location,
      state,
      level: inferLevel(divisionRaw),
      division: inferDivision(divisionRaw),
    }
  } catch {
    return null
  }
}

// DOM fallback: parse the meet list table if the API interception missed
async function parseMeetListFromDom(
  page: import('playwright').Page,
  state: string,
): Promise<MeetStub[]> {
  return page.evaluate((st) => {
    const rows = document.querySelectorAll('a[href*="/TrackAndField/Meet/"]')
    const seen = new Set<string>()
    const result: MeetStub[] = []

    for (const a of rows) {
      const href = (a as HTMLAnchorElement).href
      const match = href.match(/\/Meet\/(\d+)/)
      if (!match) continue
      const id = match[1]
      if (seen.has(id)) continue
      seen.add(id)

      const row = a.closest('tr') ?? a.parentElement
      const dateEl = row?.querySelector('[data-date], .date, td:nth-child(2)')
      const locEl = row?.querySelector('.location, td:nth-child(3)')

      result.push({
        athleticNetId: id,
        name: a.textContent?.trim() ?? '',
        date: dateEl?.textContent?.trim() ?? '',
        location: locEl?.textContent?.trim() ?? '',
        state: st,
        level: 'hs',
        division: null,
      })
    }
    return result
  }, state) as Promise<MeetStub[]>
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

// Run directly: pnpm scrape:search
if (process.argv[1]?.includes('search')) {
  const state = process.argv[2] ?? 'NC'
  console.log(`Searching for recent meets in ${state}...`)
  searchRecentMeets(state, 14)
    .then((meets) => {
      console.log(`Found ${meets.length} meets:`)
      console.dir(meets, { depth: null })
    })
    .catch(console.error)
    .finally(() => process.exit(0))
}
