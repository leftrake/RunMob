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

// AthleticNET event IDs for track events — field events are excluded
const TRACK_EVENT_NAMES: Record<number, string> = {
  1: '100m',
  2: '200m',
  3: '400m',
  4: '800m',
  5: '1500m',
  6: '1600m',
  7: '4x100m',
  8: '4x400m',
  9: '110mH',   // boys; girls get 100mH — detected by gender in parseResult
  10: '300mH',
  11: '4x800m',
  12: '3200m',
  13: '3000m',
  14: '5000m',
  15: '10000m',
  16: 'Mile',
}

interface EventListItem { e: number; d: number }

export async function scrapeMeet(athleticNetId: string, rsUrl?: string | null): Promise<ScrapedMeet | null> {
  const { page } = await newPage()

  try {
    const meetId = parseInt(athleticNetId)
    const baseUrl = rsUrl ?? `https://www.athletic.net/TrackAndField/meet/${athleticNetId}/results`
    console.log(`  Navigating to ${baseUrl}`)

    // Capture GetEventListData as the page loads
    const eventListPromise = new Promise<EventListItem[]>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = async (res: any) => {
        if (!res.url().includes('GetEventListData')) return
        try {
          const json = await res.json() as { eventDivsWithResults?: EventListItem[] }
          resolve(json.eventDivsWithResults ?? [])
        } catch {
          resolve([])
        }
        page.off('response', handler)
      }
      page.on('response', handler)
      setTimeout(() => resolve([]), 15_000)
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(2000)

    const eventList = await eventListPromise
    console.log(`  Event list: ${eventList.map((e) => e.e).join(', ')}`)

    // Filter to known track events only
    const trackEvents = eventList.filter((ev) => TRACK_EVENT_NAMES[ev.e] !== undefined)

    // Fetch results for each event+gender via page.evaluate (CF cookies stay valid)
    const allEvents: ScrapedEvent[] = []

    for (const { e: eventId, d: divId } of trackEvents) {
      for (const gender of ['m', 'f'] as const) {
        const result = await page.evaluate(
          async ({ meetId, eventId, divId, gender }: { meetId: number; eventId: number; divId: number; gender: string }) => {
            try {
              const userRes = await fetch('/api/v1/SignedInUser/GetSignedInUser', {
                headers: { accept: 'application/json', 'anet-appinfo': 'web:web:0:240' },
              })
              const user = userRes.ok ? await userRes.json() as Record<string, unknown> : {}
              const token = user.jwtUserRolesSiteWide as string | undefined

              const headers: Record<string, string> = {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/json',
                'anet-appinfo': 'web:web:0:240',
              }
              if (token) headers['anet-site-roles-token'] = token

              const res = await fetch('/api/v1/Meet/GetResultsData3', {
                method: 'POST',
                headers,
                body: JSON.stringify({ meetId, sport: 'tf', gender, eventId, divId }),
              })
              if (!res.ok) return { error: res.status }
              return { data: await res.json() }
            } catch (err) {
              return { error: String(err) }
            }
          },
          { meetId, eventId, divId, gender },
        )

        if ('error' in result) {
          console.log(`  Event ${eventId} ${gender}: ${(result as { error: unknown }).error}`)
          continue
        }

        const parsed = parseResultsData3(
          (result as { data: unknown }).data,
          gender === 'm' ? 'M' : 'F',
          eventId,
        )
        if (parsed && parsed.results.length > 0) {
          allEvents.push(parsed)
          console.log(`  ${parsed.eventName} ${gender}: ${parsed.results.length} results`)
        }
      }
    }

    // Get meet name from page title
    const title = await page.title().catch(() => '')
    const name = title.replace(/ - Results.*/, '').replace(/ \| .*/, '').trim()

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

function parseResultsData3(
  json: unknown,
  gender: 'M' | 'F',
  eventId: number,
): ScrapedEvent | null {
  try {
    const data = json as Record<string, unknown>

    // resultsTF is an array of arrays (one per heat/division)
    const outerList = (data.resultsTF as unknown[][]) ?? []
    const rawResults = outerList.flat()

    if (rawResults.length === 0) return null

    const results: ScrapedResult[] = []

    for (const raw of rawResults) {
      const r = raw as Record<string, unknown>

      const displayTime = String(r.Result ?? '').trim()
      if (!displayTime || displayTime === 'DNS' || displayTime === 'DNF' || displayTime === 'DQ' || displayTime === 'SCR' || displayTime === 'FS' || displayTime === 'NH' || displayTime === 'ND') continue

      // Skip field event results — they look like "15.23m" or "50-01.00"
      if (/m$/.test(displayTime) || /-\d{2}/.test(displayTime)) continue

      let timeSeconds: number
      try {
        // parseFloat handles "12.65a" → 12.65 (stops at letter suffix)
        timeSeconds = parseTimeToSeconds(displayTime.replace(/[a-zA-Z]+$/, ''))
        if (isNaN(timeSeconds) || timeSeconds <= 0) continue
      } catch {
        continue
      }

      const firstName = String(r.FirstName ?? r.firstName ?? '').trim()
      const lastName = String(r.LastName ?? r.lastName ?? '').trim()
      const athleteName = [firstName, lastName].filter(Boolean).join(' ') || String(r.disAthlete ?? '').trim()
      if (!athleteName) continue

      results.push({
        place: parseInt(String(r.Place ?? r.disPlace ?? '0')) || results.length + 1,
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

    // 100mH for girls, 110mH for boys
    let eventName = TRACK_EVENT_NAMES[eventId] ?? `event_${eventId}`
    if (eventId === 9 && gender === 'F') eventName = '100mH'

    return { eventName, gender, results }
  } catch {
    return null
  }
}
