export type EventGender = 'M' | 'F'
export type MeetLevel = 'hs' | 'college' | 'open'

export interface Meet {
  id: string
  name: string
  date: string
  location: string
  level: MeetLevel
  division: string | null
  state: string
  events: MeetEvent[]
  athleteRankings?: MeetAthleteRating[]
}

export interface MeetSummary {
  id: string
  name: string
  date: string
  location: string
  level: MeetLevel
  division: string | null
  state: string
  athleteCount: number
  eventCount: number
  topRating?: number
  topRatedAthleteName?: string
}

export interface MeetEvent {
  id: string
  meetId: string
  eventName: string
  gender: EventGender
  results: AthleteResult[]
}

export interface AthleteResult {
  id: string
  athleteId: string
  athleteName: string
  meetEventId: string
  round: string
  place: number
  time: number
  displayTime: string
  teamName: string
  rating: number
  ratingLabel: RatingLabel
  prAtMeet: boolean
  seasonBestAtMeet: boolean
}

export interface AthleteResultSummary {
  id: string
  meetId: string
  meetName: string
  meetDate: string
  eventName: string
  round: string
  place: number
  displayTime: string
  rating: number
  ratingLabel: RatingLabel
  prAtMeet: boolean
  seasonBestAtMeet: boolean
  meetRating: number | null
}

export interface MeetAthleteRating {
  id: string
  athleteId: string
  athleteName: string
  meetId: string
  meetRating: number
  eventCount: number
  eventRatings: Record<string, number>
}

export interface Athlete {
  id: string
  name: string
  school: string
  state: string
  gradYear: number
  gender: EventGender
  events: string[]
  seasonBests: Record<string, string>
  allTimePRs: Record<string, string>
  results: AthleteResultSummary[]
}

export type RatingLabel =
  | 'Elite'
  | 'Great'
  | 'Good'
  | 'Average'
  | 'Below avg'
  | 'Poor'

export interface RatingTier {
  min: number
  label: RatingLabel
  color: string
}
