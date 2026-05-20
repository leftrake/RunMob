import { Hono } from 'hono'
import { prisma } from '../db/client.js'

export const athletesRouter = new Hono()

athletesRouter.get('/:id', async (c) => {
  const athlete = await prisma.athlete.findUnique({
    where: { id: c.req.param('id') },
    include: {
      results: {
        include: {
          meetEvent: {
            include: { meet: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!athlete) return c.json({ error: 'Athlete not found' }, 404)

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
      place: r.place,
      displayTime: r.displayTime,
      rating: r.rating,
      ratingLabel: r.ratingLabel,
      prAtMeet: r.prAtMeet,
      seasonBestAtMeet: r.seasonBestAtMeet,
    })),
  })
})
