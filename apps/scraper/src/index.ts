import cron from 'node-cron'
import { searchRecentMeets } from './scrapers/search.js'
import { scrapeMeet } from './scrapers/meet.js'
import { ingestMeet, prisma } from './ingest.js'
import { closeBrowser, sleep } from './browser.js'
import { computeRating, computeMeetRating, getRatingLabel, isRelayEvent } from '@runmob/shared'
import { scrapeAthleteProfile, safeParseTime } from './scrapers/athlete.js'

// States to scrape — extend as needed
const STATES = (process.env.SCRAPE_STATES ?? 'NC').split(',').map((s) => s.trim())
// How many days back to look for meets
const DAYS_BACK = parseInt(process.env.SCRAPE_DAYS_BACK ?? '14')
// Whether to also scrape individual athlete profiles (slower, more data)
const SCRAPE_ATHLETES = process.env.SCRAPE_ATHLETES === 'true'
// Max meets to scrape per run (0 = no limit)
const SCRAPE_LIMIT = parseInt(process.env.SCRAPE_LIMIT ?? '0')
// Cron schedule — default every 6 hours during track season
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '0 */6 * * *'

const args = process.argv.slice(2)
const FORCE = args.includes('--force')

export async function runScrapeJob(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting scrape job${FORCE ? ' (forced)' : ''}`)
  console.log(`  States: ${STATES.join(', ')} | Days back: ${DAYS_BACK} | Scrape athletes: ${SCRAPE_ATHLETES}`)

  let totalMeets = 0
  let totalResults = 0

  for (const state of STATES) {
    console.log(`\nSearching for meets in ${state}...`)

    let stubs
    try {
      stubs = await searchRecentMeets(state, DAYS_BACK)
    } catch (err) {
      console.error(`  Search failed for ${state}:`, err)
      continue
    }

    const limited = SCRAPE_LIMIT > 0 ? stubs.slice(0, SCRAPE_LIMIT) : stubs
    console.log(`  Found ${stubs.length} meets${SCRAPE_LIMIT > 0 ? ` (capped at ${SCRAPE_LIMIT})` : ''}`)

    for (const stub of limited) {
      if (!stub.hasResults) {
        console.log(`  Skipping ${stub.name} (no results)`)
        continue
      }

      if (!FORCE) {
        const existing = await prisma.meet.findUnique({
          where: { id: stub.athleticNetId },
          include: { _count: { select: { events: true } } },
        })
        if (existing && existing._count.events > 0) {
          const meetAge = Date.now() - new Date(existing.updatedAt).getTime()
          const sixHours = 6 * 60 * 60 * 1000
          if (meetAge < sixHours) {
            console.log(`  Skipping ${stub.name} (cached)`)
            continue
          }
        }
      }

      console.log(`\n  Scraping: ${stub.name} (${stub.athleticNetId})`)

      try {
        const scraped = await scrapeMeet(stub.athleticNetId, stub.rsUrl)
        if (!scraped || scraped.events.length === 0) {
          console.log(`  No results found — skipping`)
          continue
        }

        // Stub is authoritative for metadata the scraper can't reliably extract
        const enriched = {
          ...scraped,
          name: stub.name || scraped.name,
          date: stub.date || scraped.date,
          location: stub.location || scraped.location,
          level: stub.level,
          division: stub.division,
          state: stub.state,
        }

        const result = await ingestMeet(enriched, { scrapeAthletes: SCRAPE_ATHLETES })
        totalMeets++
        totalResults += result.resultsUpserted
      } catch (err) {
        console.error(`  Failed to scrape/ingest ${stub.name}:`, err)
      }

      // Polite delay between meets
      await sleep(2000)
    }
  }

  console.log(`\n[${new Date().toISOString()}] Scrape job complete: ${totalMeets} meets, ${totalResults} results`)
  await closeBrowser()
}

async function rerateAll(): Promise<void> {
  console.log('Re-rating all results from stored data...')

  const meets = await prisma.meet.findMany({
    include: {
      events: {
        include: {
          results: { include: { athlete: true } },
        },
      },
    },
  })

  let totalResults = 0

  for (const meet of meets) {
    const athleteBestRatings = new Map<string, Map<string, number>>()

    for (const event of meet.events) {
      // Group by round and compute per-round winner time + spread
      const roundGroups = new Map<string, typeof event.results>()
      for (const r of event.results) {
        const group = roundGroups.get(r.round) ?? []
        group.push(r)
        roundGroups.set(r.round, group)
      }
      const roundStats = new Map<string, { winnerTime: number; spread: number }>()
      for (const [round, group] of roundGroups) {
        const times = group.map((r) => r.time)
        const winnerTime = Math.min(...times)
        roundStats.set(round, { winnerTime, spread: Math.max(...times) - winnerTime })
      }

      for (const result of event.results) {
        const prSeconds = safeParseTime(
          (result.athlete.allTimePRs as Record<string, string>)[event.eventName] ?? '',
        )
        const stats = roundStats.get(result.round) ?? { winnerTime: result.time, spread: 0 }
        const roundSize = roundGroups.get(result.round)?.length ?? 1

        const rating = computeRating({
          place: result.place,
          fieldSize: roundSize,
          gapToWinner: Math.max(0, result.time - stats.winnerTime),
          fieldSpread: stats.spread,
          prDelta: prSeconds !== null ? result.time - prSeconds : 0,
          eventName: event.eventName,
          gender: event.gender as 'M' | 'F',
          round: result.round,
        })

        await prisma.athleteResult.update({
          where: { id: result.id },
          data: { rating, ratingLabel: getRatingLabel(rating) },
        })
        totalResults++

        if (!isRelayEvent(event.eventName)) {
          const eventKey = `${event.eventName} ${event.gender}`
          const athleteMap = athleteBestRatings.get(result.athleteId) ?? new Map<string, number>()
          if (rating > (athleteMap.get(eventKey) ?? 0)) athleteMap.set(eventKey, rating)
          athleteBestRatings.set(result.athleteId, athleteMap)
        }
      }
    }

    // Recompute meet-level athlete ratings
    for (const [athleteId, bestByEvent] of athleteBestRatings) {
      const meetRating = computeMeetRating([...bestByEvent.values()])
      await prisma.meetAthleteRating.upsert({
        where: { athleteId_meetId: { athleteId, meetId: meet.id } },
        create: { athleteId, meetId: meet.id, meetRating, eventCount: bestByEvent.size, eventRatings: Object.fromEntries(bestByEvent) },
        update: { meetRating, eventCount: bestByEvent.size, eventRatings: Object.fromEntries(bestByEvent) },
      })
    }

    console.log(`  ${meet.name}: ${meet.events.reduce((n, e) => n + e.results.length, 0)} results`)
  }

  console.log(`\nDone: ${meets.length} meets, ${totalResults} results re-rated`)
}

async function scrapeAllAthletes(): Promise<void> {
  // Only athletes whose ID is a numeric AthleticNET ID can be looked up
  // Prisma doesn't support regex filters on IDs — filter in JS after fetch
  const allAthletes = await prisma.athlete.findMany({ orderBy: { updatedAt: 'asc' } })
  const athletes = allAthletes.filter((a) => /^\d+$/.test(a.id))

  console.log(`Scraping profiles for ${athletes.length} athletes...`)
  let updated = 0
  let failed = 0

  for (let i = 0; i < athletes.length; i++) {
    const athlete = athletes[i]
    process.stdout.write(`  [${i + 1}/${athletes.length}] ${athlete.name}... `)

    try {
      const profile = await scrapeAthleteProfile(athlete.id)
      if (!profile) {
        process.stdout.write('no data\n')
        failed++
      } else {
        // Merge: only overwrite with AthleticNET data if it's better (lower time)
        const existing = athlete.allTimePRs as Record<string, string>
        const merged: Record<string, string> = { ...existing }
        for (const [event, time] of Object.entries(profile.allTimePRs)) {
          const existingSeconds = safeParseTime(existing[event] ?? '')
          const newSeconds = safeParseTime(time)
          if (newSeconds !== null && (existingSeconds === null || newSeconds < existingSeconds)) {
            merged[event] = time
          }
        }

        await prisma.athlete.update({
          where: { id: athlete.id },
          data: {
            allTimePRs: merged,
            seasonBests: profile.seasonBests,
            school: profile.school || athlete.school,
            state: profile.state || athlete.state,
            gradYear: profile.gradYear || athlete.gradYear,
          },
        })
        process.stdout.write(`done (${Object.keys(profile.allTimePRs).length} PRs)\n`)
        updated++
      }
    } catch (err) {
      process.stdout.write(`error: ${err}\n`)
      failed++
    }

    // Polite delay between profiles
    await sleep(1000)
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`)
  console.log('Run --rerate to apply updated PRs to all ratings.')
}

// Entry point

if (args[0] === '--scrape-athletes') {
  scrapeAllAthletes()
    .catch(console.error)
    .finally(() => prisma.$disconnect().then(() => closeBrowser()).then(() => process.exit(0)))
} else if (args[0] === '--rerate') {
  rerateAll()
    .catch(console.error)
    .finally(() => prisma.$disconnect().then(() => process.exit(0)))
} else if (args[0] === '--reset-db') {
  console.log('Resetting database...')
  // Delete in dependency order — children before parents
  await prisma.meetAthleteRating.deleteMany()
  await prisma.athleteResult.deleteMany()
  await prisma.meetEvent.deleteMany()
  await prisma.meet.deleteMany()
  await prisma.athlete.deleteMany()
  console.log('Done.')
  await prisma.$disconnect()
  process.exit(0)
} else if (args[0] === '--once' || args[0] === '--run') {
  // Run immediately and exit
  runScrapeJob()
    .catch(console.error)
    .finally(() => prisma.$disconnect().then(() => process.exit(0)))
} else if (args[0] === '--meet' && args[1]) {
  // Scrape a single meet by ID: tsx src/index.ts --meet <id>
  const scraped = await scrapeMeet(args[1])
  if (scraped) {
    await ingestMeet(scraped, { scrapeAthletes: SCRAPE_ATHLETES })
  }
  await prisma.$disconnect()
  await closeBrowser()
  process.exit(0)
} else {
  // Start cron scheduler
  console.log(`Starting cron scheduler: ${CRON_SCHEDULE}`)
  console.log('Running initial job now...')

  runScrapeJob().catch(console.error)

  cron.schedule(CRON_SCHEDULE, () => {
    runScrapeJob().catch(console.error)
  })

  // Keep process alive
  process.on('SIGTERM', async () => {
    console.log('Shutting down...')
    await closeBrowser()
    await prisma.$disconnect()
    process.exit(0)
  })
}
