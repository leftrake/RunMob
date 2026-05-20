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
  seasonBestSeconds: number | null
  personalBestSeconds: number | null
  fieldAvgSeasonBest: number | null
  isLowerBetter: boolean  // true for timed events (running)
}

export function computeRating(inputs: RatingInputs): number {
  const {
    place,
    fieldSize,
    timeSeconds,
    seasonBestSeconds,
    personalBestSeconds,
    fieldAvgSeasonBest,
    isLowerBetter,
  } = inputs

  let score = 5.0

  // Place component (0-3 points)
  const placePct = (fieldSize - place) / Math.max(fieldSize - 1, 1)
  score += placePct * 3.0

  // Season best component (-1.5 to +1.5)
  if (seasonBestSeconds !== null) {
    const sbDiff = isLowerBetter
      ? (seasonBestSeconds - timeSeconds) / seasonBestSeconds
      : (timeSeconds - seasonBestSeconds) / seasonBestSeconds
    score += Math.max(-1.5, Math.min(1.5, sbDiff * 20))
  }

  // PR component (bonus up to 1.0)
  if (personalBestSeconds !== null) {
    const prDiff = isLowerBetter
      ? (personalBestSeconds - timeSeconds) / personalBestSeconds
      : (timeSeconds - personalBestSeconds) / personalBestSeconds
    if (prDiff > 0) {
      score += Math.min(1.0, prDiff * 30)
    } else {
      score += Math.max(-0.5, prDiff * 10)
    }
  }

  // Field quality component (-0.5 to +0.5)
  if (fieldAvgSeasonBest !== null) {
    const fieldDiff = isLowerBetter
      ? (fieldAvgSeasonBest - timeSeconds) / fieldAvgSeasonBest
      : (timeSeconds - fieldAvgSeasonBest) / fieldAvgSeasonBest
    score += Math.max(-0.5, Math.min(0.5, fieldDiff * 10))
  }

  return Math.max(0, Math.min(10, Math.round(score * 10) / 10))
}
