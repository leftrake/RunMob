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

// Track event IDs → {name, slug} — field events (HJ, LJ, SP, etc.) intentionally excluded
const TRACK_EVENTS: Record<number, { name: string; slug: string }> = {
  1:  { name: '100m',   slug: '100m'   },
  2:  { name: '200m',   slug: '200m'   },
  3:  { name: '400m',   slug: '400m'   },
  4:  { name: '800m',   slug: '800m'   },
  5:  { name: '1500m',  slug: '1500m'  },
  6:  { name: '1600m',  slug: '1600m'  },
  7:  { name: '4x100m', slug: '4x100m' },
  8:  { name: '4x400m', slug: '4x400m' },
  9:  { name: '110mH',  slug: '110mh'  }, // boys; girls get 100mH via slug override
  10: { name: '300mH',  slug: '300mh'  },
  11: { name: '4x800m', slug: '4x800m' },
  12: { name: '3200m',  slug: '3200m'  },
  13: { name: '3000m',  slug: '3000m'  },
  14: { name: '5000m',  slug: '5000m'  },
  15: { name: 'Mile',   slug: 'mile'   },
  16: { name: '10000m', slug: '10000m' },
}

interface EventListItem { e: number; d: number }

export async function scrapeMeet(athleticNetId: string, rsUrl?: string | null): Promise<ScrapedMeet | null> {
  const { page } = await newPage()

  try {
    const baseUrl = rsUrl ?? `https://www.athletic.net/TrackAndField/meet/${athleticNetId}/results`
    console.log(`  Navigating to ${baseUrl}`)

    // Navigate to base results page to warm up CF clearance and get event list
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(2000)

    // Try to read event list from SPA window state
    const eventList = await page.evaluate(() => {
      const win = window as Record<string, unknown>
      for (const key of Object.keys(win)) {
        const val = win[key]
        if (val && typeof val === 'object' && 'eventDivsWithResults' in (val as object)) {
          return ((val as Record<string, unknown>).eventDivsWithResults as EventListItem[]) ?? []
        }
      }
      return [] as EventListItem[]
    }).catch(() => [] as EventListItem[])

    const trackEventIds = eventList.length > 0
      ? eventList.map((e) => e.e).filter((id) => TRACK_EVENTS[id] !== undefined)
      : Object.keys(TRACK_EVENTS).map(Number)

    console.log(`  Track events to scrape: ${trackEventIds.join(', ')}`)

    const allEvents: ScrapedEvent[] = []

    // Use a fresh page per event — repeated page.goto() within the same page triggers
    // SPA client-side routing which skips the GetResultsData3 network call.
    // Fresh pages share CF clearance cookies via the shared browser context.
    for (const eventId of trackEventIds) {
      const def = TRACK_EVENTS[eventId]!
      for (const gender of ['m', 'f'] as const) {
        const slug = eventId === 9 && gender === 'f' ? '100mh' : def.slug
        const eventUrl = `${baseUrl}/${gender}/${eventId}/${slug}`

        const { page: ep } = await newPage()
        try {
          const resultPromise = new Promise<ScrapedEvent | null>((resolve) => {
            const t = setTimeout(() => resolve(null), 12_000)
            ep.on('response', async (res) => {
              if (!res.url().includes('GetResultsData3') || !res.ok()) return
              clearTimeout(t)
              try {
                const json = await res.json() as Record<string, unknown>
                resolve(parseResultsData3Response(json, gender === 'm' ? 'M' : 'F', eventId))
              } catch {
                resolve(null)
              }
            })
          })

          await ep.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          const result = await resultPromise
          if (result && result.results.length > 0) {
            allEvents.push(result)
            console.log(`  ${result.eventName} ${gender}: ${result.results.length} results`)
          }
        } catch {
          // navigation error or timeout — skip this event
        } finally {
          await ep.close()
        }
      }
    }

    const title = await page.title().catch(() => '')
    const name = title.replace(/ - Results.*/, '').replace(/ \| .*/, '').trim()

    console.log(`  Total: ${allEvents.length} event sections scraped`)

    return {
      athleticNetId,
      name,
      date: new Date().toISOString(),
      location: '',
      events: allEvents,
    }
  } catch (err) {
    console.error(`  Error scraping meet ${athleticNetId}:`, err)
    return null
  } finally {
    await page.close()
  }
}

function parseResultsData3Response(
  json: Record<string, unknown>,
  gender: 'M' | 'F',
  eventId: number,
): ScrapedEvent | null {
  try {
    const outerList = (json.resultsTF as unknown[][]) ?? []
    const rawResults = outerList.flat()
    if (rawResults.length === 0) return null

    const results: ScrapedResult[] = []

    for (const raw of rawResults) {
      const r = raw as Record<string, unknown>
      const displayTime = String(r.Result ?? '').trim()
      if (!displayTime || /^(DNS|DNF|DQ|SCR|FS|NH|ND)$/.test(displayTime)) continue
      // Field event formats: "15.23m" (meters) or "50-01.00" (feet-inches)
      if (/m$/.test(displayTime) || /-\d{2}/.test(displayTime)) continue

      let timeSeconds: number
      try {
        timeSeconds = parseTimeToSeconds(displayTime.replace(/[a-zA-Z]+$/, ''))
        if (isNaN(timeSeconds) || timeSeconds <= 0) continue
      } catch { continue }

      const firstName = String(r.FirstName ?? '').trim()
      const lastName  = String(r.LastName  ?? '').trim()
      const athleteName = [firstName, lastName].filter(Boolean).join(' ') || String(r.disAthlete ?? '').trim()
      if (!athleteName) continue

      results.push({
        place: parseInt(String(r.Place ?? '0')) || results.length + 1,
        athleteName,
        athleticNetAthleteId: String(r.AthleteID ?? '').trim() || null,
        school: String(r.SchoolName ?? r.disTeam ?? '').trim(),
        displayTime,
        timeSeconds,
        gender,
        wind: r.Wind != null ? String(r.Wind) : undefined,
      })
    }

    if (results.length === 0) return null

    const def = TRACK_EVENTS[eventId]
    if (!def) return null
    let eventName = def.name
    if (eventId === 9 && gender === 'F') eventName = '100mH'

    return { eventName, gender, results }
  } catch {
    return null
  }
}
