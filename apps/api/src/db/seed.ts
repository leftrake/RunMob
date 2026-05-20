import { PrismaClient } from '@prisma/client'
import { computeRating, getRatingLabel, parseTimeToSeconds } from '@runmob/shared'

const prisma = new PrismaClient()

const athleteData = [
  { name: 'Marcus Webb',    school: 'Durham Academy',    state: 'NC', gradYear: 2025, gender: 'M', events: ['800m', '1500m'], seasonBests: { '800m': '1:52.4', '1500m': '3:58.1' }, allTimePRs: { '800m': '1:51.8', '1500m': '3:57.2' } },
  { name: 'Alex Rivera',   school: 'Chapel Hill HS',     state: 'NC', gradYear: 2025, gender: 'M', events: ['800m', 'Mile'],  seasonBests: { '800m': '1:54.9', 'Mile': '4:22.0' },  allTimePRs: { '800m': '1:54.0', 'Mile': '4:20.5' } },
  { name: 'Sam Torres',    school: 'Raleigh Charter',    state: 'NC', gradYear: 2026, gender: 'M', events: ['800m', '1500m'], seasonBests: { '800m': '1:56.3', '1500m': '4:05.0' }, allTimePRs: { '800m': '1:55.8', '1500m': '4:04.2' } },
  { name: 'Jordan Hayes',  school: 'Myers Park',         state: 'NC', gradYear: 2025, gender: 'M', events: ['Mile', '3200m'], seasonBests: { 'Mile': '4:18.5', '3200m': '9:10.0' },  allTimePRs: { 'Mile': '4:16.2', '3200m': '9:05.1' } },
  { name: 'Eli Chambers',  school: 'Green Hope',         state: 'NC', gradYear: 2026, gender: 'M', events: ['800m'],          seasonBests: { '800m': '1:58.0' },                       allTimePRs: { '800m': '1:57.5' } },
  { name: 'Devon Price',   school: 'Cardinal Gibbons',   state: 'NC', gradYear: 2027, gender: 'M', events: ['800m'],          seasonBests: { '800m': '1:59.5' },                       allTimePRs: { '800m': '1:59.0' } },
  { name: 'Casey Nguyen',  school: 'Carrboro HS',        state: 'NC', gradYear: 2026, gender: 'M', events: ['800m'],          seasonBests: { '800m': '2:01.2' },                       allTimePRs: { '800m': '2:00.8' } },
  { name: 'Tyler Brooks',  school: 'Wake Forest HS',     state: 'NC', gradYear: 2025, gender: 'M', events: ['800m'],          seasonBests: { '800m': '2:02.0' },                       allTimePRs: { '800m': '2:01.5' } },
  // Mile
  { name: 'Owen Garrett',  school: 'Cary Academy',       state: 'NC', gradYear: 2025, gender: 'M', events: ['Mile', '3200m'], seasonBests: { 'Mile': '4:15.1', '3200m': '9:02.3' },   allTimePRs: { 'Mile': '4:14.8', '3200m': '9:00.0' } },
  { name: 'Noah Kim',      school: 'Leesville Road',     state: 'NC', gradYear: 2026, gender: 'M', events: ['Mile'],          seasonBests: { 'Mile': '4:19.3' },                       allTimePRs: { 'Mile': '4:18.0' } },
  { name: 'Finn Walsh',    school: 'Millbrook HS',       state: 'NC', gradYear: 2025, gender: 'M', events: ['Mile'],          seasonBests: { 'Mile': '4:21.0' },                       allTimePRs: { 'Mile': '4:20.2' } },
  { name: 'Luca Morrow',   school: 'East Chapel Hill',   state: 'NC', gradYear: 2027, gender: 'M', events: ['Mile'],          seasonBests: { 'Mile': '4:24.7' },                       allTimePRs: { 'Mile': '4:23.5' } },
  // Women 800m
  { name: 'Ava Mitchell',  school: 'Durham Academy',     state: 'NC', gradYear: 2025, gender: 'F', events: ['800m', 'Mile'],  seasonBests: { '800m': '2:07.3', 'Mile': '4:52.0' },    allTimePRs: { '800m': '2:06.8', 'Mile': '4:50.1' } },
  { name: 'Sofia Reyes',   school: 'Chapel Hill HS',     state: 'NC', gradYear: 2026, gender: 'F', events: ['800m'],          seasonBests: { '800m': '2:09.5' },                       allTimePRs: { '800m': '2:08.9' } },
  { name: 'Mia Johnson',   school: 'Myers Park',         state: 'NC', gradYear: 2025, gender: 'F', events: ['800m', '1500m'], seasonBests: { '800m': '2:11.0', '1500m': '4:30.2' },   allTimePRs: { '800m': '2:10.4', '1500m': '4:29.0' } },
  { name: 'Harper Ellis',  school: 'Green Hope',         state: 'NC', gradYear: 2026, gender: 'F', events: ['800m'],          seasonBests: { '800m': '2:13.8' },                       allTimePRs: { '800m': '2:13.0' } },
  { name: 'Zoe Parker',    school: 'Cardinal Gibbons',   state: 'NC', gradYear: 2025, gender: 'F', events: ['800m'],          seasonBests: { '800m': '2:15.1' },                       allTimePRs: { '800m': '2:14.5' } },
  { name: 'Isla Turner',   school: 'Raleigh Charter',    state: 'NC', gradYear: 2027, gender: 'F', events: ['800m'],          seasonBests: { '800m': '2:16.4' },                       allTimePRs: { '800m': '2:16.0' } },
]

const meetData = [
  {
    name: 'NCHSAA 4A State Championships',
    date: new Date('2025-05-10T10:00:00Z'),
    location: 'Greensboro, NC',
    level: 'hs',
    division: '4A',
    state: 'NC',
  },
]

const eventResults: Record<string, { athleteIdx: number; displayTime: string }[]> = {
  '800m-M': [
    { athleteIdx: 0, displayTime: '1:51.8' },  // Marcus – PR
    { athleteIdx: 1, displayTime: '1:54.0' },  // Alex – PR
    { athleteIdx: 2, displayTime: '1:56.3' },  // Sam – SB
    { athleteIdx: 3, displayTime: '1:57.9' },  // Jordan
    { athleteIdx: 4, displayTime: '1:58.0' },  // Eli – SB
    { athleteIdx: 5, displayTime: '1:59.2' },
    { athleteIdx: 6, displayTime: '2:01.5' },
    { athleteIdx: 7, displayTime: '2:02.8' },
  ],
  'Mile-M': [
    { athleteIdx: 8,  displayTime: '4:14.8' },  // Owen – PR
    { athleteIdx: 3,  displayTime: '4:16.4' },  // Jordan – SB
    { athleteIdx: 9,  displayTime: '4:18.0' },  // Noah – PR
    { athleteIdx: 10, displayTime: '4:21.3' },
    { athleteIdx: 11, displayTime: '4:24.7' },  // Luca – SB
  ],
  '800m-F': [
    { athleteIdx: 12, displayTime: '2:06.8' },  // Ava – PR
    { athleteIdx: 13, displayTime: '2:09.3' },  // Sofia – SB
    { athleteIdx: 14, displayTime: '2:11.0' },  // Mia – SB
    { athleteIdx: 15, displayTime: '2:13.8' },  // Harper – SB
    { athleteIdx: 16, displayTime: '2:15.5' },
    { athleteIdx: 17, displayTime: '2:17.0' },
  ],
}

async function main() {
  console.log('Seeding database...')

  await prisma.athleteResult.deleteMany()
  await prisma.meetEvent.deleteMany()
  await prisma.meet.deleteMany()
  await prisma.athlete.deleteMany()

  const athletes = await Promise.all(
    athleteData.map((a) =>
      prisma.athlete.create({
        data: {
          name: a.name,
          school: a.school,
          state: a.state,
          gradYear: a.gradYear,
          gender: a.gender,
          events: a.events,
          seasonBests: a.seasonBests,
          allTimePRs: a.allTimePRs,
        },
      })
    )
  )

  for (const meet of meetData) {
    const createdMeet = await prisma.meet.create({ data: meet })

    for (const [key, results] of Object.entries(eventResults)) {
      const [eventName, gender] = key.split('-')
      const createdEvent = await prisma.meetEvent.create({
        data: { meetId: createdMeet.id, eventName, gender },
      })

      const times = results.map((r) => parseTimeToSeconds(r.displayTime))
      const fieldAvgSB = times.reduce((a, b) => a + b, 0) / times.length

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const athlete = athletes[r.athleteIdx]
        const timeSeconds = parseTimeToSeconds(r.displayTime)
        const sbKey = eventName
        const sb = (athlete as unknown as { seasonBests: Record<string, string> }).seasonBests[sbKey]
        const pr = (athlete as unknown as { allTimePRs: Record<string, string> }).allTimePRs[sbKey]

        const sbSeconds = sb ? parseTimeToSeconds(sb) : null
        const prSeconds = pr ? parseTimeToSeconds(pr) : null

        const rating = computeRating({
          place: i + 1,
          fieldSize: results.length,
          timeSeconds,
          seasonBestSeconds: sbSeconds,
          personalBestSeconds: prSeconds,
          fieldAvgSeasonBest: fieldAvgSB,
          isLowerBetter: true,
        })

        const prAtMeet = prSeconds !== null && timeSeconds <= prSeconds
        const seasonBestAtMeet = sbSeconds !== null && timeSeconds <= sbSeconds

        await prisma.athleteResult.create({
          data: {
            athleteId: athlete.id,
            meetEventId: createdEvent.id,
            place: i + 1,
            time: timeSeconds,
            displayTime: r.displayTime,
            teamName: (athlete as unknown as { school: string }).school,
            rating,
            ratingLabel: getRatingLabel(rating),
            prAtMeet,
            seasonBestAtMeet,
          },
        })
      }
    }
  }

  console.log('Seed complete.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
