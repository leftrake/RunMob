import { Hono } from 'hono'
import { prisma } from '../db/client.js'

export const meetsRouter = new Hono()

meetsRouter.get('/', async (c) => {
  const meets = await prisma.meet.findMany({
    orderBy: { date: 'desc' },
    include: {
      events: {
        include: { results: true },
      },
    },
  })

  const summaries = meets.map((meet) => {
    const allResults = meet.events.flatMap((e) => e.results)
    const topResult = [...allResults].sort((a, b) => b.rating - a.rating)[0]
    return {
      id: meet.id,
      name: meet.name,
      date: meet.date.toISOString(),
      location: meet.location,
      level: meet.level,
      division: meet.division,
      state: meet.state,
      athleteCount: new Set(allResults.map((r) => r.athleteId)).size,
      eventCount: meet.events.length,
      topRating: topResult?.rating ?? null,
    }
  })

  return c.json(summaries)
})

meetsRouter.get('/:id', async (c) => {
  const meetId = c.req.param('id')

  const [meet, athleteRankings] = await Promise.all([
    prisma.meet.findUnique({
      where: { id: meetId },
      include: {
        events: {
          include: {
            results: {
              include: { athlete: true },
              orderBy: { place: 'asc' },
            },
          },
        },
      },
    }),
    prisma.meetAthleteRating.findMany({
      where: { meetId },
      include: { athlete: true },
      orderBy: { meetRating: 'desc' },
      take: 20,
    }),
  ])

  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  return c.json({
    id: meet.id,
    name: meet.name,
    date: meet.date.toISOString(),
    location: meet.location,
    level: meet.level,
    division: meet.division,
    state: meet.state,
    events: meet.events.map((event) => ({
      id: event.id,
      meetId: event.meetId,
      eventName: event.eventName,
      gender: event.gender,
      results: event.results.map((r) => ({
        id: r.id,
        athleteId: r.athleteId,
        athleteName: r.athlete.name,
        meetEventId: r.meetEventId,
        round: r.round,
        place: r.place,
        time: r.time,
        displayTime: r.displayTime,
        teamName: r.teamName,
        rating: r.rating,
        ratingLabel: r.ratingLabel,
        prAtMeet: r.prAtMeet,
        seasonBestAtMeet: r.seasonBestAtMeet,
      })),
    })),
    athleteRankings: athleteRankings.map((ar) => ({
      id: ar.id,
      athleteId: ar.athleteId,
      athleteName: ar.athlete.name,
      meetId: ar.meetId,
      meetRating: ar.meetRating,
      eventCount: ar.eventCount,
      eventRatings: ar.eventRatings as Record<string, number>,
    })),
  })
})
