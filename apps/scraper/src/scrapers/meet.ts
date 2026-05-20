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

// Track event IDs → name — field events (HJ, LJ, SP, etc.) intentionally excluded
const TRACK_EVENTS: Record<number, string> = {
  1:  '100m',
  2:  '200m',
  3:  '400m',
  4:  '800m',
  5:  '1500m',
  6:  '1600m',
  7:  '4x100m',
  8:  '4x400m',
  9:  '110mH',   // boys; girls get 100mH in parseResultsData3Response
  10: '300mH',
  11: '4x800m',
  12: '3200m',
  13: '3000m',
  14: '5000m',
  15: 'Mile',
  16: '10000m',
}

interface EventListItem { e: number; d: number }

export async function scrapeMeet(athleticNetId: string, rsUrl?: string | null): Promise<ScrapedMeet | null> {
  const { page } = await newPage()

  try {
    const baseUrl = rsUrl ?? `https://www.athletic.net/TrackAndField/meet/${athleticNetId}/results`
    console.log(`  Navigating to ${baseUrl}`)

    // Navigate to base results page to warm up CF clearance and get event list
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // Capture GetEventListData from the base page load
    const eventListPromise = new Promise<EventListItem[]>((resolve) => {
      const t = setTimeout(() => resolve([]), 10_000)
      page.on('response', async (res) => {
        if (!res.url().includes('GetEventListData')) return
        clearTimeout(t)
        try {
          const json = await res.json() as { eventDivsWithResults?: EventListItem[] }
          resolve(json.eventDivsWithResults ?? [])
        } catch { resolve([]) }
      })
    })

    await sleep(2000)
    const eventList = await eventListPromise

    const trackEventIds = eventList.length > 0
      ? eventList.map((e) => e.e).filter((id) => TRACK_EVENTS[id] !== undefined)
      : Object.keys(TRACK_EVENTS).map(Number)

    console.log(`  Track events to scrape: ${trackEventIds.join(', ')}`)

    const allEvents: ScrapedEvent[] = []

    // Use a fresh page per event — repeated page.goto() within the same page triggers
    // SPA client-side routing which skips the GetResultsData3 network call.
    // Fresh pages share CF clearance cookies via the shared browser context.
    for (const eventId of trackEventIds) {
      for (const gender of ['m', 'f'] as const) {
        const eventUrl = `${baseUrl}/${gender}/${eventId}`

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

    let eventName = TRACK_EVENTS[eventId]
    if (!eventName) return null
    if (eventId === 9 && gender === 'F') eventName = '100mH'

    return { eventName, gender, results }
  } catch {
    return null
  }
}
