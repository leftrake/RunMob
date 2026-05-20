import { Hono } from 'hono'
import { prisma } from '../db/client.js'

export const searchRouter = new Hono()

searchRouter.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q || q.length < 2) return c.json({ athletes: [], meets: [] })

  const [athletes, meets] = await Promise.all([
    prisma.athlete.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { school: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
    prisma.meet.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      take: 10,
    }),
  ])

  return c.json({
    athletes: athletes.map((a) => ({
      id: a.id,
      name: a.name,
      school: a.school,
      state: a.state,
      gender: a.gender,
      gradYear: a.gradYear,
    })),
    meets: meets.map((m) => ({
      id: m.id,
      name: m.name,
      date: m.date.toISOString(),
      location: m.location,
      level: m.level,
      state: m.state,
    })),
  })
})
