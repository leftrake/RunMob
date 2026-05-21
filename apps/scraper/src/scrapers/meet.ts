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
  round: string
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

    // Set up listener BEFORE goto — GetEventListData fires during page load
    const eventListPromise = new Promise<EventListItem[]>((resolve) => {
      const t = setTimeout(() => resolve([]), 15_000)
      page.on('response', async (res) => {
        if (!res.url().includes('GetEventListData')) return
        clearTimeout(t)
        try {
          const json = await res.json() as { eventDivsWithResults?: EventListItem[] }
          resolve(json.eventDivsWithResults ?? [])
        } catch { resolve([]) }
      })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const eventList = await eventListPromise
    await sleep(500)

    // Keep e (event ID) + d (division) together — URL format is /{gender}/{d}/{slug}, not /{e}/{slug}
    const trackEvents = eventList.length > 0
      ? eventList.filter((item) => TRACK_EVENTS[item.e] !== undefined)
      : Object.keys(TRACK_EVENTS).map(Number).map((id) => ({ e: id, d: 1 }))

    console.log(`  Track events to scrape: ${trackEvents.map((t) => `${TRACK_EVENTS[t.e]}(d${t.d})`).join(', ')}`)

    const allEvents: ScrapedEvent[] = []

    // Use a fresh page per event — repeated page.goto() within the same page triggers
    // SPA client-side routing which skips the GetResultsData3 network call.
    // Fresh pages share CF clearance cookies via the shared browser context.
    for (const { e: eventId, d: division } of trackEvents) {
      for (const gender of ['m', 'f'] as const) {
        // Girls run 100mH, boys run 110mH — different slug for female event 9
        const eventSlug = (eventId === 9 && gender === 'f')
          ? '100mh'
          : (TRACK_EVENTS[eventId] ?? '').toLowerCase()
        const eventUrl = `${baseUrl}/${gender}/${division}/${eventSlug}`

        const { page: ep } = await newPage()
        try {
          // Accumulate results from ALL GetResultsData3 responses (prelims + finals are separate calls)
          const allRoundResults: ScrapedResult[] = []
          let eventMeta: { eventName: string; gender: 'M' | 'F' } | null = null
          let noResults = false
          let lastResponseAt = 0
          let responseCount = 0

          ep.on('response', async (res) => {
            if (!res.url().includes('GetResultsData3') || !res.ok()) return
            try {
              const json = await res.json() as Record<string, unknown>
              if (json.currentEventValid === false && !json.eventId) { noResults = true; return }
              lastResponseAt = Date.now()
              responseCount++
              const outerArr = (json.resultsTF as unknown[][]) ?? []
              console.log(`    GetResultsData3 #${responseCount}: ${outerArr.flat().length} rows`)
              const parsed = parseResultsData3Response(json, gender === 'm' ? 'M' : 'F', eventId)
              if (parsed && parsed.results.length > 0) {
                if (!eventMeta) eventMeta = { eventName: parsed.eventName, gender: parsed.gender }
                const existingKeys = new Set(allRoundResults.map((r) => `${r.athleteName}-${r.round}`))
                for (const r of parsed.results) {
                  if (!existingKeys.has(`${r.athleteName}-${r.round}`)) allRoundResults.push(r)
                }
              }
            } catch { /* ignore */ }
          })

          console.log(`    -> ${eventUrl}`)
          await ep.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          // Wait up to 10s total, but exit 2s after the last response arrives
          const startedAt = Date.now()
          while (!noResults && Date.now() - startedAt < 10_000) {
            await sleep(200)
            if (responseCount > 0 && Date.now() - lastResponseAt > 2_000) break
          }

          // eventMeta may be set by async handler — cast to avoid TS control-flow narrowing to null
          const meta = eventMeta as { eventName: string; gender: 'M' | 'F' } | null
          if (meta && allRoundResults.length > 0) {
            allEvents.push({ eventName: meta.eventName, gender: meta.gender, results: allRoundResults })
            console.log(`    ${meta.eventName} ${gender}: ${allRoundResults.length} results`)
          }
        } catch (err) {
          console.log(`    Error for ${eventUrl}: ${err}`)
        } finally {
          await ep.close()
        }

        await sleep(500)
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
    if (outerList.length === 0 || outerList.every((arr) => arr.length === 0)) return null

    // Map IDRound → RoundDesc so each result's Round field ("F", "P", etc.) resolves correctly
    const roundById = new Map(
      ((json.rounds as Array<{ IDRound: string; RoundDesc: string }>) ?? []).map((r) => [r.IDRound, r.RoundDesc])
    )

    const results: ScrapedResult[] = []

    for (const roundArr of outerList) {
      for (const raw of roundArr) {
        const r = raw as Record<string, unknown>
        const displayTime = String(r.Result ?? '').trim()
        if (!displayTime || /^(DNS|DNF|DQ|SCR|FS|NH|ND)$/.test(displayTime)) continue
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

        const roundId = String(r.Round ?? 'F')
        const round = roundById.get(roundId) ?? (roundId === 'F' ? 'Finals' : roundId === 'P' ? 'Prelims' : roundId)

        results.push({
          place: parseInt(String(r.Place ?? '0')) || results.length + 1,
          athleteName,
          athleticNetAthleteId: String(r.AthleteID ?? '').trim() || null,
          school: String(r.SchoolName ?? r.disTeam ?? '').trim(),
          displayTime,
          timeSeconds,
          gender,
          wind: r.Wind != null ? String(r.Wind) : undefined,
          round,
        })
      }
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
