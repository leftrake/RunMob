import { PrismaClient } from '@prisma/client'
import { computeRating, getRatingLabel, parseTimeToSeconds } from '@runmob/shared'
import type { ScrapedMeet } from './scrapers/meet.js'
import { scrapeAthleteProfile, safeParseTime } from './scrapers/athlete.js'
import { sleep } from './browser.js'

const prisma = new PrismaClient()

export interface IngestResult {
  meetId: string
  eventsUpserted: number
  resultsUpserted: number
  athletesUpserted: number
}

export async function ingestMeet(
  scraped: ScrapedMeet,
  opts = { scrapeAthletes: false },
): Promise<IngestResult> {
  console.log(`Ingesting meet: ${scraped.name}`)

  // Upsert the meet
  const meet = await prisma.meet.upsert({
    where: { id: scraped.athleticNetId },
    create: {
      id: scraped.athleticNetId,
      name: scraped.name,
      date: new Date(scraped.date),
      location: scraped.location,
      level: scraped.level ?? 'hs',
      division: scraped.division ?? null,
      state: scraped.state ?? '',
    },
    update: {
      name: scraped.name,
      date: new Date(scraped.date),
      location: scraped.location,
      level: scraped.level ?? 'hs',
      division: scraped.division ?? null,
      state: scraped.state ?? '',
    },
  })

  let eventsUpserted = 0
  let resultsUpserted = 0
  let athletesUpserted = 0

  for (const scrapedEvent of scraped.events) {
    // Upsert meet event
    const existingEvent = await prisma.meetEvent.findFirst({
      where: { meetId: meet.id, eventName: scrapedEvent.eventName, gender: scrapedEvent.gender },
    })

    const meetEvent = existingEvent ?? await prisma.meetEvent.create({
      data: { meetId: meet.id, eventName: scrapedEvent.eventName, gender: scrapedEvent.gender },
    })
    eventsUpserted++

    // Pre-compute per-round field stats so ratings are relative to each round's field
    const roundGroups = new Map<string, typeof scrapedEvent.results>()
    for (const r of scrapedEvent.results) {
      const group = roundGroups.get(r.round) ?? []
      group.push(r)
      roundGroups.set(r.round, group)
    }
    const roundFieldAvg = new Map<string, number | null>()
    for (const [round, results] of roundGroups) {
      const times = results.map((r) => r.timeSeconds).filter((t) => t > 0)
      roundFieldAvg.set(round, times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null)
    }

    for (const r of scrapedEvent.results) {
      // Find or create athlete
      let athlete = await prisma.athlete.findFirst({
        where: { name: r.athleteName, school: r.school },
      })

      if (!athlete) {
        // Optionally scrape athlete profile for PR history
        let profile = null
        if (opts.scrapeAthletes && r.athleticNetAthleteId) {
          console.log(`    Fetching profile for ${r.athleteName}...`)
          profile = await scrapeAthleteProfile(r.athleticNetAthleteId)
          await sleep(500)
        }

        athlete = await prisma.athlete.create({
          data: {
            id: r.athleticNetAthleteId ?? undefined,
            name: r.athleteName,
            school: r.school,
            state: profile?.state ?? '',
            gradYear: profile?.gradYear ?? new Date().getFullYear() + 1,
            gender: r.gender,
            events: [scrapedEvent.eventName],
            seasonBests: profile?.seasonBests ?? {},
            allTimePRs: profile?.allTimePRs ?? {},
          },
        })
        athletesUpserted++
      }

      // Look up athlete's best time from PRIOR meets only — same-meet results don't count as SB
      const existingResults = await prisma.athleteResult.findMany({
        where: {
          athleteId: athlete.id,
          meetEvent: { eventName: scrapedEvent.eventName, meetId: { not: meet.id } },
        },
        orderBy: { time: 'asc' },
        take: 1,
      })

      const sbSeconds = existingResults[0]?.time ?? null
      const prSeconds = safeParseTime(
        (athlete.allTimePRs as Record<string, string>)[scrapedEvent.eventName] ?? '',
      )

      const roundSize = roundGroups.get(r.round)?.length ?? 1
      const rating = computeRating({
        place: r.place,
        fieldSize: roundSize,
        timeSeconds: r.timeSeconds,
        seasonBestSeconds: sbSeconds,
        personalBestSeconds: prSeconds,
        fieldAvgSeasonBest: roundFieldAvg.get(r.round) ?? null,
        isLowerBetter: true,
      })

      const prAtMeet = prSeconds !== null && r.timeSeconds <= prSeconds
      // sbSeconds is null when this is the athlete's first recorded result — that's always an SB
      const seasonBestAtMeet = sbSeconds === null || r.timeSeconds <= sbSeconds

      // Update athlete's season best if this is faster
      if (sbSeconds === null || r.timeSeconds < sbSeconds) {
        const updatedBests = {
          ...(athlete.seasonBests as Record<string, string>),
          [scrapedEvent.eventName]: r.displayTime,
        }
        await prisma.athlete.update({
          where: { id: athlete.id },
          data: { seasonBests: updatedBests },
        })
      }

      // Upsert result (keyed on athlete + meetEvent)
      const round = r.round ?? 'Finals'
      await prisma.athleteResult.upsert({
        where: {
          id: `${athlete.id}-${meetEvent.id}-${round}`,
        },
        create: {
          id: `${athlete.id}-${meetEvent.id}-${round}`,
          athleteId: athlete.id,
          meetEventId: meetEvent.id,
          round,
          place: r.place,
          time: r.timeSeconds,
          displayTime: r.displayTime,
          teamName: r.school,
          rating,
          ratingLabel: getRatingLabel(rating),
          prAtMeet,
          seasonBestAtMeet,
        },
        update: {
          place: r.place,
          time: r.timeSeconds,
          displayTime: r.displayTime,
          rating,
          ratingLabel: getRatingLabel(rating),
          prAtMeet,
          seasonBestAtMeet,
        },
      })
      resultsUpserted++
    }
  }

  console.log(`  Done: ${eventsUpserted} events, ${resultsUpserted} results, ${athletesUpserted} new athletes`)
  return { meetId: meet.id, eventsUpserted, resultsUpserted, athletesUpserted }
}

export { prisma }
