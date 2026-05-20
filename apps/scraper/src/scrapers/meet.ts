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
  9:  { name: '110mH',  slug: '110mh'  }, // boys; overridden to 100mH for girls
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

    // Persistent listener — captures GetResultsData3 responses from any navigation on this page
    const capturedByUrl = new Map<string, ScrapedEvent>()

    page.on('response', async (res) => {
      if (!res.url().includes('GetResultsData3')) return
      if (!res.ok()) return
      try {
        const json = await res.json() as Record<string, unknown>
        const outerList = (json.resultsTF as unknown[][]) ?? []
        const rawResults = outerList.flat()
        if (rawResults.length === 0) return

        const first = rawResults[0] as Record<string, unknown>
        const genderChar = String(first.Gender ?? '').toUpperCase()
        const gender: 'M' | 'F' = genderChar === 'F' ? 'F' : 'M'
        const eventId = Number(first.EventID ?? 0)

        const eventDef = TRACK_EVENTS[eventId]
        if (!eventDef) return  // field event or unknown

        const results: ScrapedResult[] = []

        for (const raw of rawResults) {
          const r = raw as Record<string, unknown>
          const displayTime = String(r.Result ?? '').trim()
          if (!displayTime || /^(DNS|DNF|DQ|SCR|FS|NH|ND)$/.test(displayTime)) continue
          // Field event result formats: "15.23m" or "50-01.00"
          if (/m$/.test(displayTime) || /-\d{2}/.test(displayTime)) continue

          let timeSeconds: number
          try {
            timeSeconds = parseTimeToSeconds(displayTime.replace(/[a-zA-Z]+$/, ''))
            if (isNaN(timeSeconds) || timeSeconds <= 0) continue
          } catch { continue }

          const firstName = String(r.FirstName ?? '').trim()
          const lastName  = String(r.LastName ?? '').trim()
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

        if (results.length === 0) return

        let eventName = eventDef.name
        if (eventId === 9 && gender === 'F') eventName = '100mH'

        const key = `${eventId}-${gender}`
        if (!capturedByUrl.has(key)) {
          capturedByUrl.set(key, { eventName, gender, results })
          console.log(`  ${eventName} ${gender}: ${results.length} results`)
        }
      } catch { /* ignore */ }
    })

    // Navigate to base results page to get event list and warm up CF
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(2000)

    // Get event list from page state
    const eventList = await page.evaluate(() => {
      // AthleticNET stores app state in window — try common keys
      const win = window as Record<string, unknown>
      for (const key of Object.keys(win)) {
        const val = win[key]
        if (val && typeof val === 'object' && 'eventDivsWithResults' in (val as object)) {
          return ((val as Record<string, unknown>).eventDivsWithResults as EventListItem[]) ?? []
        }
      }
      return [] as EventListItem[]
    }).catch(() => [] as EventListItem[])

    // Fall back: use all known track event IDs if window state unavailable
    const trackEventIds = eventList.length > 0
      ? eventList.map((e) => e.e).filter((id) => TRACK_EVENTS[id] !== undefined)
      : Object.keys(TRACK_EVENTS).map(Number)

    console.log(`  Track events to scrape: ${trackEventIds.join(', ')}`)

    // Navigate to each event×gender page — the SPA's own JS calls GetResultsData3
    for (const eventId of trackEventIds) {
      const def = TRACK_EVENTS[eventId]!
      for (const gender of ['m', 'f'] as const) {
        const slug = eventId === 9 && gender === 'f' ? '100mh' : def.slug
        const eventUrl = `${baseUrl}/${gender}/${eventId}/${slug}`
        try {
          await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await sleep(1500)
        } catch {
          // timeout or navigation error — skip this event
        }
      }
    }

    const events = Array.from(capturedByUrl.values())
    console.log(`  Total: ${events.length} event sections scraped`)

    // Get meet name from page title
    const title = await page.title().catch(() => '')
    const name = title.replace(/ - Results.*/, '').replace(/ \| .*/, '').trim()

    return {
      athleticNetId,
      name,
      date: new Date().toISOString(),
      location: '',
      events,
    }
  } catch (err) {
    console.error(`  Error scraping meet ${athleticNetId}:`, err)
    return null
  } finally {
    await page.close()
  }
}
