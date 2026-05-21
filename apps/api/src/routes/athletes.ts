import { Hono } from 'hono'
import { prisma } from '../db/client.js'

export const athletesRouter = new Hono()

athletesRouter.get('/:id', async (c) => {
  const athleteId = c.req.param('id')

  const [athlete, meetRatings] = await Promise.all([
    prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        results: {
          include: { meetEvent: { include: { meet: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
    prisma.meetAthleteRating.findMany({
      where: { athleteId },
      orderBy: { meet: { date: 'desc' } },
    }),
  ])

  if (!athlete) return c.json({ error: 'Athlete not found' }, 404)

  const meetRatingById = new Map(meetRatings.map((mr) => [mr.meetId, mr.meetRating]))

  return c.json({
    id: athlete.id,
    name: athlete.name,
    school: athlete.school,
    state: athlete.state,
    gradYear: athlete.gradYear,
    gender: athlete.gender,
    events: athlete.events,
    seasonBests: athlete.seasonBests,
    allTimePRs: athlete.allTimePRs,
    results: athlete.results.map((r) => ({
      id: r.id,
      meetId: r.meetEvent.meetId,
      meetName: r.meetEvent.meet.name,
      meetDate: r.meetEvent.meet.date.toISOString(),
      eventName: r.meetEvent.eventName,
      round: r.round,
      place: r.place,
      displayTime: r.displayTime,
      rating: r.rating,
      ratingLabel: r.ratingLabel,
      prAtMeet: r.prAtMeet,
      seasonBestAtMeet: r.seasonBestAtMeet,
      meetRating: meetRatingById.get(r.meetEvent.meetId) ?? null,
    })),
  })
})
