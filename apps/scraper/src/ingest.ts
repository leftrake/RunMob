import { PrismaClient } from '@prisma/client'
import { computeRating, computeMeetRating, getRatingLabel } from '@runmob/shared'
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

  // Accumulate best rating per athlete per event for meet-level rating computation
  const athleteBestRatings = new Map<string, Map<string, number>>()

  for (const scrapedEvent of scraped.events) {
    const existingEvent = await prisma.meetEvent.findFirst({
      where: { meetId: meet.id, eventName: scrapedEvent.eventName, gender: scrapedEvent.gender },
    })
    const meetEvent = existingEvent ?? await prisma.meetEvent.create({
      data: { meetId: meet.id, eventName: scrapedEvent.eventName, gender: scrapedEvent.gender },
    })
    eventsUpserted++

    // Log round breakdown
    const roundCounts = scrapedEvent.results.reduce<Record<string, number>>((acc, r) => {
      acc[r.round] = (acc[r.round] ?? 0) + 1
      return acc
    }, {})
    console.log(`  ${scrapedEvent.eventName} ${scrapedEvent.gender}: ${Object.entries(roundCounts).map(([r, n]) => `${r}=${n}`).join(', ')}`)

    // Per-round field sizes
    const roundGroups = new Map<string, typeof scrapedEvent.results>()
    for (const r of scrapedEvent.results) {
      const group = roundGroups.get(r.round) ?? []
      group.push(r)
      roundGroups.set(r.round, group)
    }

    for (const r of scrapedEvent.results) {
      let athlete = await prisma.athlete.findFirst({
        where: { name: r.athleteName, school: r.school },
      })

      // Fallback: same athlete may appear with slightly different name/school across meets
      if (!athlete && r.athleticNetAthleteId) {
        athlete = await prisma.athlete.findUnique({ where: { id: r.athleticNetAthleteId } })
      }

      if (!athlete) {
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

      // SB from prior meets only
      const priorResults = await prisma.athleteResult.findMany({
        where: {
          athleteId: athlete.id,
          meetEvent: { eventName: scrapedEvent.eventName, meetId: { not: meet.id } },
        },
        orderBy: { time: 'asc' },
        take: 1,
      })
      const sbSeconds = priorResults[0]?.time ?? null
      const prSeconds = safeParseTime(
        (athlete.allTimePRs as Record<string, string>)[scrapedEvent.eventName] ?? '',
      )

      const roundSize = roundGroups.get(r.round)?.length ?? 1
      const rating = computeRating({
        place: r.place,
        fieldSize: roundSize,
        timeSeconds: r.timeSeconds,
        eventName: scrapedEvent.eventName,
        gender: r.gender,
        personalBestSeconds: prSeconds,
        round: r.round,
      })

      // Only flag PR when we have a baseline and they beat it
      const prAtMeet = prSeconds !== null && r.timeSeconds <= prSeconds
      const seasonBestAtMeet = sbSeconds === null || r.timeSeconds <= sbSeconds

      if (sbSeconds === null || r.timeSeconds < sbSeconds) {
        await prisma.athlete.update({
          where: { id: athlete.id },
          data: {
            seasonBests: {
              ...(athlete.seasonBests as Record<string, string>),
              [scrapedEvent.eventName]: r.displayTime,
            },
          },
        })
      }

      // Persist all-time PR so future meets have a baseline
      if (prSeconds === null || r.timeSeconds < prSeconds) {
        await prisma.athlete.update({
          where: { id: athlete.id },
          data: {
            allTimePRs: {
              ...(athlete.allTimePRs as Record<string, string>),
              [scrapedEvent.eventName]: r.displayTime,
            },
          },
        })
      }

      // Add event to athlete's event list if not already there
      if (!(athlete.events as string[]).includes(scrapedEvent.eventName)) {
        await prisma.athlete.update({
          where: { id: athlete.id },
          data: { events: { push: scrapedEvent.eventName } },
        })
      }

      const round = r.round ?? 'Finals'
      await prisma.athleteResult.upsert({
        where: { id: `${athlete.id}-${meetEvent.id}-${round}` },
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

      // Track best rating per event per athlete (for meet-level rating)
      const eventKey = `${scrapedEvent.eventName} ${r.gender}`
      const athleteMap = athleteBestRatings.get(athlete.id) ?? new Map<string, number>()
      if (rating > (athleteMap.get(eventKey) ?? 0)) athleteMap.set(eventKey, rating)
      athleteBestRatings.set(athlete.id, athleteMap)
    }
  }

  // Compute and store meet-level athlete ratings
  for (const [athleteId, bestByEvent] of athleteBestRatings) {
    const eventRatings = Object.fromEntries(bestByEvent)
    const meetRating = computeMeetRating([...bestByEvent.values()])
    await prisma.meetAthleteRating.upsert({
      where: { athleteId_meetId: { athleteId, meetId: meet.id } },
      create: { athleteId, meetId: meet.id, meetRating, eventCount: bestByEvent.size, eventRatings },
      update: { meetRating, eventCount: bestByEvent.size, eventRatings },
    })
  }

  console.log(`  Done: ${eventsUpserted} events, ${resultsUpserted} results, ${athletesUpserted} new athletes`)
  return { meetId: meet.id, eventsUpserted, resultsUpserted, athletesUpserted }
}

export { prisma }
