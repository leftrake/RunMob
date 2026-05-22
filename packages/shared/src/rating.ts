import type { RatingLabel, RatingTier } from './types.js'

export const RATING_TIERS: RatingTier[] = [
  { min: 9.0, label: 'Elite',     color: '#4ade80' }, // bright green
  { min: 8.0, label: 'Great',     color: '#a3e635' }, // lime
  { min: 7.0, label: 'Good',      color: '#facc15' }, // yellow
  { min: 5.5, label: 'Average',   color: '#f97316' }, // orange
  { min: 4.0, label: 'Below avg', color: '#f87171' }, // light red
  { min: 0,   label: 'Poor',      color: '#ef4444' }, // red
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

const PR_CENTER = 0

// How many seconds = one meaningful sigma for PR comparison, per event.
// Sprints are sensitive to tenths; distance events need seconds of movement.
const PR_SCALE_BY_EVENT: Record<string, number> = {
  '100m':    0.5,
  '200m':    0.8,
  '400m':    1.5,
  '800m':    3.0,
  '1500m':   5.0,
  '1600m':   5.0,
  'Mile':    6.0,
  '3200m':   8.0,
  '5000m':  12.0,
  '10000m': 20.0,
  '110mH':   0.6,
  '100mH':   0.6,
  '300mH':   1.5,
  '4x100m':  1.0,
  '4x400m':  3.0,
  '4x800m':  8.0,
}

// Minimum field spread used as denominator for gap score, per event.
// Prevents a tight elite field from inflating gap penalties for tiny time differences.
const MIN_SPREAD_BY_EVENT: Record<string, number> = {
  '100m':    0.5,
  '200m':    1.0,
  '400m':    2.0,
  '800m':    5.0,
  '1500m':  10.0,
  '1600m':  10.0,
  'Mile':   12.0,
  '3200m':  20.0,
  '5000m':  30.0,
  '10000m': 60.0,
  '110mH':   1.0,
  '100mH':   1.0,
  '300mH':   2.0,
  '4x100m':  1.0,
  '4x400m':  4.0,
  '4x800m': 10.0,
}

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
  /** timeSeconds − personalBest. Negative = beat PR. null = no PR on file. */
  prDelta: number | null
  eventName: string
  gender: 'M' | 'F'
  round: string
}

export function computeRating(inputs: RatingInputs): number {
  const { place, fieldSize, gapToWinner, fieldSpread, prDelta, eventName } = inputs

  // 1. Place score: percentile within field (0–1)
  const placeScore = fieldSize > 1 ? (fieldSize - place) / (fieldSize - 1) : 1

  // 2. Gap score: closeness to winner relative to field spread (0–1)
  //    Use event-specific minimum spread so a tight elite field doesn't warp the scale
  const minSpread = MIN_SPREAD_BY_EVENT[eventName] ?? 5.0
  const gapScore = 1 - clamp(gapToWinner / Math.max(fieldSpread, minSpread), 0, 1)

  let raw: number
  if (prDelta === null) {
    // No PR data — only place and gap contribute. Max raw = 0.75 → max score 7.5.
    // This prevents first-race winners from always hitting ~8.8 regardless of context.
    raw = placeScore * WEIGHT_PLACE + gapScore * WEIGHT_GAP
  } else {
    // 3. PR score: sigmoid — negative delta (beat PR) pushes above 0.5, positive below.
    //    Scale is event-specific: 0.5s matters a lot in the 100m, barely registers in the 3200m.
    const prScale = PR_SCALE_BY_EVENT[eventName] ?? 5.0
    const prScore = sigmoid(-prDelta, PR_CENTER, prScale)
    raw = placeScore * WEIGHT_PLACE + gapScore * WEIGHT_GAP + prScore * WEIGHT_PR
  }

  // Map 0–1 to 1–10 (floor at 1 so even last place gets a score)
  return Math.round(clamp(raw * 10, 1, 10) * 10) / 10
}

// Meet-level athlete rating: best event as base + quality-gated bonus per additional event.
// Mediocre events (≤5.0) give no bonus — only genuinely good performances in multiple events
// should boost the meet rating.
export function computeMeetRating(eventRatings: number[]): number {
  if (eventRatings.length === 0) return 0
  const sorted = [...eventRatings].sort((a, b) => b - a)
  const primary = sorted[0]
  const bonus = sorted.slice(1).reduce((sum, r) => sum + Math.max(0, r - 5.0) * 0.15, 0)
  return Math.min(10, Math.round((primary + bonus) * 10) / 10)
}

export function isRelayEvent(eventName: string): boolean {
  return eventName.startsWith('4x')
}
