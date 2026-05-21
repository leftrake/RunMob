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
  const { place, fieldSize, timeSeconds, personalBestSeconds, round } = inputs

  // 1. Field score: rank percentile + log-weighted field size (0–10)
  //    Winning a 2-person heat scores lower than winning a 30-person final.
  const rankPct = fieldSize > 1 ? (fieldSize - place) / (fieldSize - 1) : 0.5
  const sizeWeight = Math.log(Math.min(fieldSize, 50)) / Math.log(50)
  const fieldScore = (0.7 * rankPct + 0.3 * sizeWeight) * 10

  // 2. Personal-time score: how much faster/slower than personal best (0–10)
  //    No PR on file → neutral 5.0.
  //    Beat PR by ≥5% → 10; 5% slower than PR → 0; linear in between.
  let prScore = 5.0
  if (personalBestSeconds !== null && personalBestSeconds > 0) {
    const delta = (personalBestSeconds - timeSeconds) / personalBestSeconds
    prScore = Math.max(0, Math.min(10, 5 + delta * 100))
  }

  // Finals get a small boost — highest-stakes round
  const roundBonus = round === 'Finals' ? 0.3 : 0

  const raw = 0.6 * fieldScore + 0.4 * prScore + roundBonus
  return Math.max(0, Math.min(10, Math.round(raw * 10) / 10))
}

// Meet-level athlete rating: best event rating + bonus for additional events.
// Makes it genuinely hard to max out when doubling/tripling up.
export function computeMeetRating(eventRatings: number[]): number {
  if (eventRatings.length === 0) return 0
  const sorted = [...eventRatings].sort((a, b) => b - a)
  const primary = sorted[0]
  const additionalBonus = sorted.slice(1).reduce((sum, r) => sum + r * 0.15, 0)
  return Math.min(10, Math.round((primary + additionalBonus) * 10) / 10)
}
