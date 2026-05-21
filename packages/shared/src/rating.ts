import type { RatingLabel, RatingTier } from './types.js'

export const RATING_TIERS: RatingTier[] = [
  { min: 9.0, label: 'Elite',     color: '#f59e0b' }, // amber
  { min: 8.0, label: 'Great',     color: '#22c55e' }, // green
  { min: 7.0, label: 'Good',      color: '#60a5fa' }, // blue
  { min: 5.5, label: 'Average',   color: '#a78bfa' }, // purple
  { min: 4.0, label: 'Below avg', color: '#9ca3af' }, // gray
  { min: 0,   label: 'Poor',      color: '#9ca3af' }, // gray
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

// Weights must sum to 1.0
const WEIGHT_PLACE = 0.40
const WEIGHT_GAP   = 0.35
const WEIGHT_PR    = 0.25

// Sigmoid: centered at 0s delta, scale of 5s means ±5s moves the curve meaningfully
const PR_CENTER = 0
const PR_SCALE  = 5

function sigmoid(x: number, center: number, scale: number): number {
  return 1 / (1 + Math.exp(-(x - center) / scale))
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

export interface RatingInputs {
  place: number
  fieldSize: number
  /** Seconds behind the winner (0 if first place) */
  gapToWinner: number
  /** Spread in seconds from winner to last place */
  fieldSpread: number
  /** timeSeconds − personalBest. Negative = beat PR. Pass 0 if no PR on file. */
  prDelta: number
  eventName: string
  gender: 'M' | 'F'
  round: string
}

export function computeRating(inputs: RatingInputs): number {
  const { place, fieldSize, gapToWinner, fieldSpread, prDelta } = inputs

  // 1. Place score: percentile within field (0–1)
  const placeScore = fieldSize > 1 ? (fieldSize - place) / (fieldSize - 1) : 1

  // 2. Gap score: closeness to winner relative to field spread (0–1)
  const gapScore = 1 - clamp(gapToWinner / Math.max(fieldSpread, 1), 0, 1)

  // 3. PR score: sigmoid — negative delta (beat PR) pushes above 0.5, positive below
  //    When prDelta=0 (no PR data or exact PR match), score is neutral 0.5
  const prScore = sigmoid(-prDelta, PR_CENTER, PR_SCALE)

  const raw = placeScore * WEIGHT_PLACE + gapScore * WEIGHT_GAP + prScore * WEIGHT_PR

  // Map 0–1 to 1–10 (floor at 1 so even last place gets a score)
  return Math.round(clamp(raw * 10, 1, 10) * 10) / 10
}

// Meet-level athlete rating: best event as base + diminishing bonus per additional event.
// Running a second or third event adds value — hard to max out but multi-event athletes
// score meaningfully higher than single-event athletes at the same level.
export function computeMeetRating(eventRatings: number[]): number {
  if (eventRatings.length === 0) return 0
  const sorted = [...eventRatings].sort((a, b) => b - a)
  const primary = sorted[0]
  const bonus = sorted.slice(1).reduce((sum, r) => sum + r * 0.15, 0)
  return Math.min(10, Math.round((primary + bonus) * 10) / 10)
}

export function isRelayEvent(eventName: string): boolean {
  return eventName.startsWith('4x')
}
