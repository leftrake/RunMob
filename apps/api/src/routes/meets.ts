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
    const topResult = allResults.sort((a, b) => b.rating - a.rating)[0]
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
      topRatedAthleteName: null as string | null,
    }
  })

  return c.json(summaries)
})

meetsRouter.get('/:id', async (c) => {
  const meet = await prisma.meet.findUnique({
    where: { id: c.req.param('id') },
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
  })

  if (!meet) return c.json({ error: 'Meet not found' }, 404)

  const response = {
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
  }

  return c.json(response)
})
