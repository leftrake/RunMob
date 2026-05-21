import cron from 'node-cron'
import { searchRecentMeets } from './scrapers/search.js'
import { scrapeMeet } from './scrapers/meet.js'
import { ingestMeet, prisma } from './ingest.js'
import { closeBrowser, sleep } from './browser.js'

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

// Entry point

if (args[0] === '--reset-db') {
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
