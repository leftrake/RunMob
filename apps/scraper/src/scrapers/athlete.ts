import { newPage, sleep } from '../browser.js'
import { parseTimeToSeconds } from '@runmob/shared'

export interface AthleteProfile {
  athleticNetId: string
  name: string
  school: string
  state: string
  gradYear: number
  gender: 'M' | 'F'
  seasonBests: Record<string, string>
  allTimePRs: Record<string, string>
}

export async function scrapeAthleteProfile(
  athleticNetId: string,
): Promise<AthleteProfile | null> {
  const { page, context } = await newPage()

  try {
    let captured: AthleteProfile | null = null

    // Intercept athlete profile API
    await page.route('**/api/v1/Athlete/GetAthleteInfo**', async (route) => {
      const response = await route.fetch()
      const json = await response.json().catch(() => null)
      if (json) captured = parseAthleteApiResponse(athleticNetId, json)
      await route.fulfill({ response })
    })

    await page.goto(
      `https://www.athletic.net/TrackAndField/Athlete/${athleticNetId}/TrackAndField`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    )
    await sleep(1500)

    if (!captured) {
      captured = await parseAthleteFromDom(page, athleticNetId)
    }

    return captured
  } catch (err) {
    console.error(`  Error scraping athlete ${athleticNetId}:`, err)
    return null
  } finally {
    await context.close()
  }
}

function parseAthleteApiResponse(
  id: string,
  json: Record<string, unknown>,
): AthleteProfile | null {
  try {
    const athlete = (json.athlete ?? json.Athlete ?? json) as Record<string, unknown>
    const name = [athlete.FirstName ?? athlete.firstName, athlete.LastName ?? athlete.lastName]
      .filter(Boolean).join(' ').trim() || String(athlete.Name ?? athlete.name ?? '').trim()
    if (!name) return null

    const genderRaw = String(athlete.Gender ?? athlete.gender ?? '').toLowerCase()
    const gender: 'M' | 'F' = genderRaw === 'f' || genderRaw === 'female' || genderRaw === 'girls' ? 'F' : 'M'

    const seasonBests: Record<string, string> = {}
    const allTimePRs: Record<string, string> = {}

    const bests = (json.seasonBests ?? json.SeasonBests ?? json.prs ?? json.PRs ?? []) as unknown[]
    for (const b of bests) {
      const best = b as Record<string, unknown>
      const event = String(best.EventName ?? best.eventName ?? best.event ?? '').trim()
      const time = String(best.Result ?? best.result ?? best.time ?? '').trim()
      if (event && time && isValidTime(time)) {
        seasonBests[event] = time
      }
    }

    const prs = (json.allTimePRs ?? json.AllTimePRs ?? json.careerBests ?? json.CareerBests ?? []) as unknown[]
    for (const p of prs) {
      const pr = p as Record<string, unknown>
      const event = String(pr.EventName ?? pr.eventName ?? pr.event ?? '').trim()
      const time = String(pr.Result ?? pr.result ?? pr.time ?? '').trim()
      if (event && time && isValidTime(time)) {
        allTimePRs[event] = time
      }
    }

    return {
      athleticNetId: id,
      name,
      school: String(athlete.SchoolName ?? athlete.schoolName ?? athlete.school ?? '').trim(),
      state: String(athlete.State ?? athlete.state ?? '').trim(),
      gradYear: Number(athlete.GradYear ?? athlete.gradYear ?? athlete.classYear ?? new Date().getFullYear() + 1),
      gender,
      seasonBests,
      allTimePRs,
    }
  } catch {
    return null
  }
}

async function parseAthleteFromDom(
  page: import('playwright').Page,
  id: string,
): Promise<AthleteProfile | null> {
  return page.evaluate((athleticNetId) => {
    const name = document.querySelector('h1, [class*="athlete-name"], [class*="athleteName"]')?.textContent?.trim() ?? ''
    if (!name) return null

    const school = document.querySelector('[class*="school"], [class*="team"]')?.textContent?.trim() ?? ''
    const gradYearMatch = document.body.innerText.match(/Class of (\d{4})|'(\d{2})\b/)
    const gradYear = gradYearMatch
      ? parseInt(gradYearMatch[1] ?? `20${gradYearMatch[2]}`)
      : new Date().getFullYear() + 1

    const genderMeta = document.querySelector('[data-gender]')?.getAttribute('data-gender') ?? ''
    const gender: 'M' | 'F' = /f/i.test(genderMeta) ? 'F' : 'M'

    const seasonBests: Record<string, string> = {}
    const allTimePRs: Record<string, string> = {}

    // Personal bests table — common pattern on AthleticNet athlete pages
    const pbRows = document.querySelectorAll('[class*="pr-row"], [class*="bestTime"], table.prs tr')
    for (const row of pbRows) {
      const cells = row.querySelectorAll('td')
      if (cells.length >= 2) {
        const event = cells[0].textContent?.trim() ?? ''
        const time = cells[1].textContent?.trim() ?? ''
        if (event && time) allTimePRs[event] = time
      }
    }

    return {
      athleticNetId,
      name,
      school,
      state: '',
      gradYear,
      gender,
      seasonBests,
      allTimePRs,
    }
  }, id) as Promise<AthleteProfile | null>
}

function isValidTime(t: string): boolean {
  return /^\d{1,2}(:\d{2}(\.\d+)?|\.\d+)$/.test(t.trim())
}

// Validate and safely parse a time — returns null on failure
export function safeParseTime(t: string): number | null {
  try {
    if (!isValidTime(t)) return null
    return parseTimeToSeconds(t)
  } catch {
    return null
  }
}
