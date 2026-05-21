import type { RatingLabel, RatingTier } from './types.js'

export const RATING_TIERS: RatingTier[] = [
  { min: 9.5, label: 'Legendary',     color: '#22c55e' },
  { min: 8.5, label: 'Outstanding',   color: '#16a34a' },
  { min: 7.5, label: 'Great',         color: '#65a30d' },
  { min: 6.5, label: 'Good',          color: '#ca8a04' },
  { min: 5.5, label: 'Average',       color: '#d97706' },
  { min: 4.5, label: 'Below Average', color: '#ea580c' },
  { min: 0,   label: 'Poor',          color: '#dc2626' },
]

export function getRatingTier(rating: number): RatingTier {
  return RATING_TIERS.find((t) => rating >= t.min) ?? RATING_TIERS[RATING_TIERS.length - 1]
}

export function getRatingLabel(rating: number): RatingLabel {
  return getRatingTier(rating).label
}

export function getRatingColor(rating: number): string {
  return getRatingTier(rating).color
}

// World Athletics scoring coefficients: points = A × (B − T_seconds)^C
// Relay events use per-leg average time with the individual event formula.
// 1600m, 3200m, Mile derived from adjacent official events.
interface WaCoeff { A: number; B: number; C: number }

const WA_MEN: Record<string, WaCoeff> = {
  '100m':   { A: 25.4347,   B: 18.0,   C: 1.81 },
  '200m':   { A: 5.8425,    B: 38.0,   C: 1.81 },
  '400m':   { A: 1.53775,   B: 82.0,   C: 1.81 },
  '800m':   { A: 0.11193,   B: 254.0,  C: 1.88 },
  '1500m':  { A: 0.03768,   B: 480.0,  C: 1.85 },
  '1600m':  { A: 0.03768,   B: 509.0,  C: 1.85 }, // derived: B ≈ 480 × (1600/1500)^0.9
  'Mile':   { A: 0.03768,   B: 512.0,  C: 1.85 }, // 1609m ≈ 1600m
  '3000m':  { A: 0.00544,   B: 600.0,  C: 1.90 },
  '3200m':  { A: 0.00544,   B: 637.0,  C: 1.90 }, // derived: B ≈ 600 × (3200/3000)^0.9
  '5000m':  { A: 0.00148,   B: 960.0,  C: 1.92 },
  '10000m': { A: 0.000415,  B: 1920.0, C: 1.88 },
  '110mH':  { A: 5.74352,   B: 28.5,   C: 1.92 },
  '300mH':  { A: 0.80089,   B: 97.0,   C: 1.835 },
  // Relays: per-leg avg uses individual formula
  '4x100m': { A: 25.4347,   B: 18.0,   C: 1.81 },
  '4x400m': { A: 1.53775,   B: 82.0,   C: 1.81 },
  '4x800m': { A: 0.11193,   B: 254.0,  C: 1.88 },
}

const WA_WOMEN: Record<string, WaCoeff> = {
  '100m':   { A: 17.857,    B: 21.0,   C: 1.81 },
  '200m':   { A: 4.99669,   B: 42.5,   C: 1.81 },
  '400m':   { A: 1.34285,   B: 91.7,   C: 1.81 },
  '800m':   { A: 0.07506,   B: 291.0,  C: 1.88 },
  '1500m':  { A: 0.02989,   B: 535.0,  C: 1.85 },
  '1600m':  { A: 0.02989,   B: 567.0,  C: 1.85 }, // derived: B ≈ 535 × (1600/1500)^0.9
  'Mile':   { A: 0.02989,   B: 570.0,  C: 1.85 },
  '3000m':  { A: 0.00437,   B: 650.0,  C: 1.90 },
  '3200m':  { A: 0.00437,   B: 690.0,  C: 1.90 }, // derived
  '5000m':  { A: 0.000949,  B: 1078.0, C: 1.92 },
  '10000m': { A: 0.000269,  B: 2158.0, C: 1.88 },
  '100mH':  { A: 9.2376,    B: 26.7,   C: 1.835 },
  '300mH':  { A: 0.54532,   B: 110.0,  C: 1.835 },
  '4x100m': { A: 17.857,    B: 21.0,   C: 1.81 },
  '4x400m': { A: 1.34285,   B: 91.7,   C: 1.81 },
  '4x800m': { A: 0.07506,   B: 291.0,  C: 1.88 },
}

const RELAY_LEGS: Record<string, number> = { '4x100m': 4, '4x400m': 4, '4x800m': 4 }

// WA points floor/ceiling calibrated to HS level:
// ~400 pts = poor JV, ~1000 pts = elite state-champion level
const WA_FLOOR = 400
const WA_CEILING = 1000

export function computeWaPoints(timeSeconds: number, eventName: string, gender: 'M' | 'F'): number {
  const table = gender === 'M' ? WA_MEN : WA_WOMEN
  const coeff = table[eventName]
  if (!coeff) return 0

  const legs = RELAY_LEGS[eventName] ?? 1
  const t = timeSeconds / legs  // per-leg time for relays

  const diff = coeff.B - t
  if (diff <= 0) return 0
  return coeff.A * Math.pow(diff, coeff.C)
}

export interface RatingInputs {
  place: number
  fieldSize: number
  timeSeconds: number
  eventName: string
  gender: 'M' | 'F'
  personalBestSeconds: number | null
  round: string
}

export function computeRating(inputs: RatingInputs): number {
  const { place, fieldSize, timeSeconds, eventName, gender, personalBestSeconds, round } = inputs

  // 1. Time quality via WA points (0–10)
  const waPoints = computeWaPoints(timeSeconds, eventName, gender)
  const timeScore = Math.max(0, Math.min(10, (waPoints - WA_FLOOR) / (WA_CEILING - WA_FLOOR) * 10))

  // 2. Field performance: rank percentile weighted by log of field size (0–10)
  const rankPct = fieldSize > 1 ? (fieldSize - place) / (fieldSize - 1) : 0.5
  const sizeBonus = Math.log(Math.min(fieldSize, 30)) / Math.log(30)
  const fieldScore = (0.7 * rankPct + 0.3 * sizeBonus) * 10

  // 3. PR improvement bonus (−0.5 to +1.0)
  let improvementBonus = 0
  if (personalBestSeconds !== null) {
    const prDiff = (personalBestSeconds - timeSeconds) / personalBestSeconds
    improvementBonus = Math.max(-0.5, Math.min(1.0, prDiff * 15))
  }

  // Finals results get a small boost — they're the highest-stakes round
  const roundBonus = round === 'Finals' ? 0.2 : 0

  const raw = 0.5 * timeScore + 0.4 * fieldScore + improvementBonus + roundBonus
  return Math.max(0, Math.min(10, Math.round(raw * 10) / 10))
}

// Meet-level athlete rating: best event rating + bonus for additional events
// Makes it genuinely hard to max out when doubling/tripling up.
export function computeMeetRating(eventRatings: number[]): number {
  if (eventRatings.length === 0) return 0
  const sorted = [...eventRatings].sort((a, b) => b - a)
  const primary = sorted[0]
  const additionalBonus = sorted.slice(1).reduce((sum, r) => sum + r * 0.15, 0)
  return Math.min(10, Math.round((primary + additionalBonus) * 10) / 10)
}
