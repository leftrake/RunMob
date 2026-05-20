import { newPage, sleep } from '../browser.js'
import { parseTimeToSeconds } from '@runmob/shared'

export interface ScrapedResult {
  place: number
  athleteName: string
  athleticNetAthleteId: string | null
  school: string
  displayTime: string
  timeSeconds: number
  gender: 'M' | 'F'
  wind?: string
}

export interface ScrapedEvent {
  eventName: string
  gender: 'M' | 'F'
  results: ScrapedResult[]
}

export interface ScrapedMeet {
  athleticNetId: string
  name: string
  date: string
  location: string
  level?: 'hs' | 'college' | 'open'
  division?: string | null
  state?: string
  events: ScrapedEvent[]
}

const FIELD_EVENTS = new Set(['High Jump', 'Long Jump', 'Triple Jump', 'Pole Vault', 'Shot Put', 'Discus', 'Javelin', 'Hammer'])

export async function scrapeMeet(athleticNetId: string, rsUrl?: string | null): Promise<ScrapedMeet | null> {
  const { page, context } = await newPage()

  try {
    const captured: { events: ScrapedEvent[] } = { events: [] }

    // Intercept AthleticNet's results API — the SPA fetches JSON for each event
    await page.route('**/api/v1/Meet/GetMeetData**', async (route) => {
      const response = await route.fetch()
      const text = await response.text().catch(() => '')
      console.log(`  GetMeetData status: ${response.status()} | body (first 600): ${text.slice(0, 600)}`)
      try {
        const json = JSON.parse(text)
        const parsed = parseMeetDataResponse(json)
        console.log(`  Parsed ${parsed.length} events from GetMeetData`)
        captured.events.push(...parsed)
      } catch { /* not JSON */ }
      await route.fulfill({ response, body: text })
    })

    // Also intercept the results endpoint some newer meets use
    await page.route('**/api/v1/Meet/GetResultsData**', async (route) => {
      const response = await route.fetch()
      const text = await response.text().catch(() => '')
      console.log(`  GetResultsData status: ${response.status()} | body (first 600): ${text.slice(0, 600)}`)
      try {
        const json = JSON.parse(text)
        const parsed = parseMeetDataResponse(json)
        console.log(`  Parsed ${parsed.length} events from GetResultsData`)
        captured.events.push(...parsed)
      } catch { /* not JSON */ }
      await route.fulfill({ response, body: text })
    })

    const url = rsUrl ?? `https://www.athletic.net/TrackAndField/meet/${athleticNetId}/results`
    console.log(`  Navigating to ${url}`)

    // Log all XHR/fetch calls so we can find the correct API endpoint
    page.on('request', (req) => {
      if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
        console.log(`  >> ${req.method()} ${req.url()}`)
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    console.log(`  Final URL: ${page.url()}`)
    await sleep(3000)

    // Grab meet metadata from the page title/header
    const name = await page.$eval('h1, .meet-name, [class*="meetName"]', (el) => el.textContent?.trim() ?? '').catch(() => '')
    const date = await page.$eval('[class*="date"], .meet-date, time', (el) => el.getAttribute('datetime') ?? el.textContent?.trim() ?? '').catch(() => '')
    const location = await page.$eval('[class*="location"], .meet-location, [class*="venue"]', (el) => el.textContent?.trim() ?? '').catch(() => '')

    // If API interception captured events, use those; otherwise parse DOM
    if (captured.events.length === 0) {
      console.log('  API interception missed — falling back to DOM parsing')
      const domEvents = await parseMeetFromDom(page)
      captured.events.push(...domEvents)
    }

    console.log(`  Scraped ${captured.events.length} events`)

    return {
      athleticNetId,
      name,
      date: normalizeDate(date),
      location,
      events: captured.events,
    }
  } catch (err) {
    console.error(`  Error scraping meet ${athleticNetId}:`, err)
    return null
  } finally {
    await page.close()
  }
}

// Parse AthleticNet's JSON API response — field names may vary by version
function parseMeetDataResponse(json: Record<string, unknown>): ScrapedEvent[] {
  const events: ScrapedEvent[] = []

  // Newer API wraps events in json.events or json.resultsList
  const rawEvents =
    (json.events as unknown[]) ??
    (json.resultsList as unknown[]) ??
    (json.divisions as unknown[]) ??
    []

  for (const rawEvent of rawEvents) {
    const ev = rawEvent as Record<string, unknown>
    const eventName = String(ev.EventName ?? ev.eventName ?? ev.name ?? '').trim()
    if (!eventName || FIELD_EVENTS.has(eventName)) continue

    const genderRaw = String(ev.Gender ?? ev.gender ?? ev.sex ?? '').toLowerCase()
    const gender: 'M' | 'F' = genderRaw === 'f' || genderRaw === 'female' || genderRaw === 'girls' || genderRaw === 'w' ? 'F' : 'M'

    const rawResults =
      (ev.results as unknown[]) ??
      (ev.Results as unknown[]) ??
      (ev.athletes as unknown[]) ??
      []

    const results: ScrapedResult[] = []

    for (const rawResult of rawResults) {
      const r = rawResult as Record<string, unknown>
      const displayTime = String(r.Result ?? r.result ?? r.time ?? r.Time ?? r.mark ?? '').trim()

      if (!displayTime || displayTime === 'DNS' || displayTime === 'DNF' || displayTime === 'DQ' || displayTime === 'SCR') continue

      let timeSeconds: number
      try {
        timeSeconds = parseTimeToSeconds(displayTime)
      } catch {
        continue
      }

      const athleteName = [
        r.FirstName ?? r.firstName ?? '',
        r.LastName ?? r.lastName ?? '',
      ].filter(Boolean).join(' ').trim() || String(r.Name ?? r.name ?? r.athleteName ?? '').trim()

      if (!athleteName) continue

      results.push({
        place: Number(r.Place ?? r.place ?? r.rank ?? 0),
        athleteName,
        athleticNetAthleteId: String(r.AthleteID ?? r.athleteId ?? r.AthNum ?? '').trim() || null,
        school: String(r.SchoolName ?? r.schoolName ?? r.team ?? r.Team ?? '').trim(),
        displayTime,
        timeSeconds,
        gender,
        wind: r.Wind ? String(r.Wind) : undefined,
      })
    }

    if (results.length > 0) {
      events.push({ eventName: normalizeEventName(eventName), gender, results })
    }
  }

  return events
}

// DOM fallback for when API interception misses
async function parseMeetFromDom(page: import('playwright').Page): Promise<ScrapedEvent[]> {
  return page.evaluate(() => {
    const events: ScrapedEvent[] = []

    // AthleticNet renders event sections with headings and result tables
    // Selector patterns observed as of 2024 — may need adjustment
    const sections = document.querySelectorAll('[class*="event-section"], [class*="eventSection"], section[data-event]')

    for (const section of sections) {
      const heading = section.querySelector('h2, h3, [class*="event-name"], [class*="eventName"]')
      if (!heading) continue

      const headingText = heading.textContent?.trim() ?? ''
      const gender: 'M' | 'F' = /girls|women|female/i.test(headingText) ? 'F' : 'M'
      const eventName = headingText.replace(/girls|boys|men|women/gi, '').trim()

      const rows = section.querySelectorAll('tr[class*="result"], tbody tr')
      const results: ScrapedResult[] = []

      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length < 3) continue

        const place = parseInt(cells[0].textContent?.trim() ?? '0')
        const nameEl = cells[1].querySelector('a') ?? cells[1]
        const athleteName = nameEl.textContent?.trim() ?? ''
        const school = cells[2].textContent?.trim() ?? ''
        const displayTime = cells[3]?.textContent?.trim() ?? ''

        if (!athleteName || !displayTime) continue

        const href = (nameEl as HTMLAnchorElement).href ?? ''
        const idMatch = href.match(/\/Athlete\/(\d+)/)

        let timeSeconds: number
        try {
          const parts = displayTime.split(':')
          timeSeconds = parts.length === 2
            ? parseInt(parts[0]) * 60 + parseFloat(parts[1])
            : parseFloat(parts[0])
        } catch { continue }

        results.push({
          place: isNaN(place) ? results.length + 1 : place,
          athleteName,
          athleticNetAthleteId: idMatch ? idMatch[1] : null,
          school,
          displayTime,
          timeSeconds,
          gender,
        })
      }

      if (results.length > 0) {
        events.push({ eventName, gender, results })
      }
    }

    return events
  }) as Promise<ScrapedEvent[]>
}

function normalizeEventName(raw: string): string {
  const map: Record<string, string> = {
    '100 Meters': '100m',
    '200 Meters': '200m',
    '400 Meters': '400m',
    '800 Meters': '800m',
    '1500 Meters': '1500m',
    '1600 Meters': '1600m',
    'Mile Run': 'Mile',
    '1 Mile Run': 'Mile',
    '3000 Meters': '3000m',
    '3200 Meters': '3200m',
    '2 Mile Run': '2 Mile',
    '5000 Meters': '5000m',
    '110 Meter Hurdles': '110mH',
    '100 Meter Hurdles': '100mH',
    '300 Meter Hurdles': '300mH',
    '400 Meter Hurdles': '400mH',
    '4x100 Meter Relay': '4x100m',
    '4x400 Meter Relay': '4x400m',
    '4x800 Meter Relay': '4x800m',
    '4 x 100 Meter Relay': '4x100m',
    '4 x 400 Meter Relay': '4x400m',
    '4 x 800 Meter Relay': '4x800m',
  }
  return map[raw] ?? raw
}

function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

// Run directly: pnpm scrape:meet <meetId>
if (process.argv[1]?.includes('meet')) {
  const meetId = process.argv[2]
  if (!meetId) { console.error('Usage: pnpm scrape:meet <athleticNetMeetId>'); process.exit(1) }
  console.log(`Scraping meet ${meetId}...`)
  scrapeMeet(meetId)
    .then((data) => console.dir(data, { depth: null }))
    .catch(console.error)
    .finally(() => process.exit(0))
}
