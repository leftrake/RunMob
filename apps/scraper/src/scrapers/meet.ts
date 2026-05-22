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
interface ScrapeTarget { eventId: number; division: number; gender: 'm' | 'f' }

export async function scrapeMeet(athleticNetId: string, rsUrl?: string | null): Promise<ScrapedMeet | null> {
  const { page } = await newPage()

  try {
    const baseUrl = rsUrl ?? `https://www.athletic.net/TrackAndField/meet/${athleticNetId}/results`
    console.log(`  Navigating to ${baseUrl}`)

    // Accumulate ALL GetEventListData items — the response can fire more than once.
    // Set up listener BEFORE goto so we don't miss early responses.
    const allEventListItems: EventListItem[] = []
    const eventListDone = new Promise<void>((resolve) => {
      const deadline = setTimeout(resolve, 15_000)
      page.on('response', async (res) => {
        if (!res.url().includes('GetEventListData')) return
        clearTimeout(deadline)
        try {
          const json = await res.json() as { eventDivsWithResults?: EventListItem[] }
          allEventListItems.push(...(json.eventDivsWithResults ?? []))
        } catch { /* ignore */ }
        // Short grace window for any follow-up GetEventListData calls before settling
        setTimeout(resolve, 1_500)
      })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await eventListDone
    await sleep(300)

    // Build confirmed map: eventId → Set<division>
    const confirmedDivs = new Map<number, Set<number>>()
    for (const { e, d } of allEventListItems) {
      if (!confirmedDivs.has(e)) confirmedDivs.set(e, new Set())
      confirmedDivs.get(e)!.add(d)
    }

    const hasEventList = allEventListItems.length > 0

    // Build scrape targets.
    // Always try every TRACK_EVENT — use confirmed divisions when available, fall back to d=1.
    // Never skip an event just because it wasn't in GetEventListData (that list can be incomplete).
    const targets: ScrapeTarget[] = []
    for (const id of Object.keys(TRACK_EVENTS).map(Number)) {
      const divs = confirmedDivs.get(id)
      const divisionsToTry = divs ? [...divs] : [1]
      for (const d of divisionsToTry) {
        targets.push({ eventId: id, division: d, gender: 'm' })
        targets.push({ eventId: id, division: d, gender: 'f' })
      }
    }

    if (hasEventList) {
      const summary = [...confirmedDivs.entries()]
        .filter(([id]) => TRACK_EVENTS[id])
        .map(([id, divs]) => `${TRACK_EVENTS[id]}(d${[...divs].join(',')})`)
        .join(', ')
      console.log(`  Confirmed events: ${summary} — unconfirmed events still tried at d=1`)
    } else {
      console.log(`  Event list unavailable — trying all ${Object.keys(TRACK_EVENTS).length} events at d=1`)
    }

    const allEvents: ScrapedEvent[] = []
    const noDataTargets: ScrapeTarget[] = []

    // First pass — normal timeouts
    for (const target of targets) {
      const result = await scrapeEventPage(baseUrl, target)
      if (result) {
        allEvents.push(result)
        console.log(`    ${result.eventName} ${target.gender.toUpperCase()}: ${result.results.length} results`)
      } else if (confirmedDivs.has(target.eventId)) {
        // Event was confirmed in GetEventListData but returned no data — queue for retry
        noDataTargets.push(target)
      }
      await sleep(400)
    }

    // Retry passes — if an event came up empty, try it again fresh (up to 2 more times).
    // Since failures are random (overlay, CF flicker) rather than systematic, a clean
    // re-attempt with normal timeouts is more effective than a single long-wait retry.
    let stillMissing = noDataTargets
    for (let pass = 1; pass <= 2 && stillMissing.length > 0; pass++) {
      console.log(`  Retry pass ${pass}: ${stillMissing.length} events...`)
      await sleep(1_000)  // brief pause before retry so any transient overlay clears
      const stillMissingAfter: ScrapeTarget[] = []
      for (const target of stillMissing) {
        const result = await scrapeEventPage(baseUrl, target)
        if (result) {
          allEvents.push(result)
          console.log(`    [retry ${pass} ok] ${result.eventName} ${target.gender.toUpperCase()}: ${result.results.length} results`)
        } else {
          stillMissingAfter.push(target)
          console.log(`    [retry ${pass} fail] ${TRACK_EVENTS[target.eventId]} ${target.gender.toUpperCase()}`)
        }
        await sleep(400)
      }
      stillMissing = stillMissingAfter
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

// Scrape a single event page, collecting all GetResultsData3 responses (prelims + finals).
// Returns null if no results were found within the timeout window.
async function scrapeEventPage(
  baseUrl: string,
  target: ScrapeTarget,
  opts: { maxWaitMs?: number; noResultsMinWaitMs?: number } = {},
): Promise<ScrapedEvent | null> {
  const { eventId, division, gender } = target
  const { maxWaitMs = 15_000, noResultsMinWaitMs = 7_000 } = opts
  const genderEnum = gender === 'm' ? 'M' : 'F'
  const eventSlug = (eventId === 9 && gender === 'f') ? '100mh' : (TRACK_EVENTS[eventId] ?? '').toLowerCase()
  const eventUrl = `${baseUrl}/${gender}/${division}/${eventSlug}`

  // Fresh page per event — reusing a page causes SPA client-side routing which skips the API call.
  // Use a fresh browser context (not shared) so previous pages' sessionStorage/localStorage state
  // doesn't leak in and cause the SPA to skip fetching event data it thinks is already cached.
  const { page, context } = await newPage()
  let ownedContext = false
  try {
    // If the returned page's context is the shared one, create an isolated context instead so
    // stale SPA state from prior event pages can't interfere.  Copy cookies for CF clearance.
    const browser = context.browser()
    if (browser) {
      const isolatedCtx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: {
          'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
      })
      await isolatedCtx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      // Copy cookies from shared context so CF clearance is inherited
      const cookies = await context.cookies()
      if (cookies.length > 0) await isolatedCtx.addCookies(cookies)

      await page.close()  // close the shared-context page we don't need
      ownedContext = true

      const isolatedPage = await isolatedCtx.newPage()
      return await _scrapeEventPageInner(isolatedPage, eventUrl, genderEnum, eventId, maxWaitMs, noResultsMinWaitMs)
        .finally(() => isolatedCtx.close())
    }

    // Fallback: no browser reference — use the shared-context page as-is
    ownedContext = true  // _scrapeEventPageInner closes the page
    return await _scrapeEventPageInner(page, eventUrl, genderEnum, eventId, maxWaitMs, noResultsMinWaitMs)
  } catch (err) {
    console.log(`    Error for ${eventUrl}: ${err}`)
    return null
  } finally {
    if (!ownedContext) await page.close().catch(() => {})
  }
}

async function _scrapeEventPageInner(
  page: Awaited<ReturnType<typeof newPage>>['page'],
  eventUrl: string,
  genderEnum: 'M' | 'F',
  eventId: number,
  maxWaitMs: number,
  noResultsMinWaitMs: number,
): Promise<ScrapedEvent | null> {
  try {
    const allRoundResults: ScrapedResult[] = []
    let eventMeta: { eventName: string; gender: 'M' | 'F' } | null = null
    let noResultsAt = 0
    let lastResponseAt = 0
    let responseCount = 0
    let anyGetResponse = false

    page.on('response', async (res) => {
      const url = res.url()
      // Diagnostic: log any AthleticNET API call so we can see what's firing
      if (url.includes('athletic.net') && (url.includes('GetResults') || url.includes('GetEvent'))) {
        console.log(`    [api] ${url.split('/').pop()?.split('?')[0] ?? url} (${res.status()})`)
        anyGetResponse = true
      }
      if (!url.includes('GetResultsData3') || !res.ok()) return
      try {
        const json = await res.json() as Record<string, unknown>
        if (json.currentEventValid === false && !json.eventId) {
          if (noResultsAt === 0) noResultsAt = Date.now()
          return
        }
        lastResponseAt = Date.now()
        responseCount++
        const outerArr = (json.resultsTF as unknown[][]) ?? []
        console.log(`    GetResultsData3 #${responseCount}: ${outerArr.flat().length} rows`)
        const parsed = parseResultsData3Response(json, genderEnum, eventId)
        if (parsed && parsed.results.length > 0) {
          if (!eventMeta) eventMeta = { eventName: parsed.eventName, gender: parsed.gender }
          const existingKeys = new Set(allRoundResults.map((r) => `${r.athleteName}-${r.round}`))
          for (const r of parsed.results) {
            if (!existingKeys.has(`${r.athleteName}-${r.round}`)) allRoundResults.push(r)
          }
        }
      } catch (err) {
        console.log(`    [parse err] ${err}`)
      }
    })

    console.log(`    -> ${eventUrl}`)
    // Use 'load' (not 'domcontentloaded') so the SPA JavaScript bundle has fully executed
    // before we start interacting — prevents the API call from being missed during boot.
    await page.goto(eventUrl, { waitUntil: 'load', timeout: 30_000 })

    // Bring the tab to front and dismiss any overlay/ad/modal.
    await page.bringToFront().catch(() => {})
    await sleep(300)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(400)
    // Click center-page to ensure the SPA considers the tab "active" and fires data requests.
    await page.mouse.click(640, 400).catch(() => {})
    await sleep(300)

    // Wait loop:
    // - Exit 2s after the last valid data response (prelims and finals may be separate calls)
    // - Exit noResultsMinWaitMs after the noResults signal — measured from THAT moment
    // - Hard cap at maxWaitMs
    const startedAt = Date.now()
    while (Date.now() - startedAt < maxWaitMs) {
      await sleep(200)
      if (noResultsAt > 0 && responseCount === 0 && Date.now() - noResultsAt > noResultsMinWaitMs) break
      if (responseCount > 0 && Date.now() - lastResponseAt > 2_000) break
    }

    if (responseCount === 0 && noResultsAt === 0) {
      console.log(`    [warn] no GetResultsData3 received after ${maxWaitMs}ms (anyApiCall=${anyGetResponse})`)
    }

    const meta = eventMeta as { eventName: string; gender: 'M' | 'F' } | null
    if (meta && allRoundResults.length > 0) {
      return { eventName: meta.eventName, gender: meta.gender, results: allRoundResults }
    }
    return null
  } catch (err) {
    console.log(`    Error for ${eventUrl}: ${err}`)
    return null
  } finally {
    await page.close().catch(() => {})
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

    let eventName = TRACK_EVENTS[eventId]
    if (!eventName) return null
    if (eventId === 9 && gender === 'F') eventName = '100mH'

    const isRelay = eventName.startsWith('4x')
    const results: ScrapedResult[] = []

    if (isRelay) {
      // AthleticNET relay rows are flat: team-level rows (no LastName) set the place/time context;
      // individual member rows (have LastName + Grade) inherit that context.
      let team: { place: number; timeSeconds: number; displayTime: string; school: string; round: string } | null = null

      for (const raw of outerList.flat()) {
        const r = raw as Record<string, unknown>
        const displayTime = String(r.Result ?? '').trim()
        const hasMemberFields = 'LastName' in r

        if (!hasMemberFields) {
          // Team-level row — capture context for following member rows
          if (!displayTime || /^(DNS|DNF|DQ|SCR|FS|NH|ND)$/.test(displayTime)) { team = null; continue }
          let timeSeconds: number
          try {
            timeSeconds = parseTimeToSeconds(displayTime.replace(/[a-zA-Z]+$/, ''))
            if (isNaN(timeSeconds) || timeSeconds <= 0) { team = null; continue }
          } catch { team = null; continue }
          const roundId = String(r.Round ?? 'F')
          const round = roundById.get(roundId) ?? (roundId === 'F' ? 'Finals' : roundId === 'P' ? 'Prelims' : roundId)
          team = {
            place: parseInt(String(r.Place ?? '0')) || 0,
            timeSeconds,
            displayTime,
            school: String(r.SchoolName ?? r.disTeam ?? '').trim(),
            round,
          }
        } else {
          // Individual member row — inherit team context
          if (!team) continue
          const firstName = String(r.FirstName ?? '').trim()
          const lastName  = String(r.LastName  ?? '').trim()
          const athleteName = [firstName, lastName].filter(Boolean).join(' ')
          if (!athleteName) continue
          results.push({
            place: team.place,
            athleteName,
            athleticNetAthleteId: String(r.AthleteID ?? '').trim() || null,
            school: team.school,
            displayTime: team.displayTime,
            timeSeconds: team.timeSeconds,
            gender,
            round: team.round,
          })
        }
      }
    } else {
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
    }

    if (results.length === 0) return null

    return { eventName, gender, results }
  } catch {
    return null
  }
}
