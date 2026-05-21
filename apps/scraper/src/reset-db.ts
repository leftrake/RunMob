import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

console.log('Clearing all tables...')
await prisma.athleteResult.deleteMany()
await prisma.meetEvent.deleteMany()
await prisma.meet.deleteMany()
await prisma.athlete.deleteMany()
console.log('Done.')
await prisma.$disconnect()
