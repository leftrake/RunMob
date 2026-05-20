export function parseTimeToSeconds(display: string): number {
  const parts = display.trim().split(':')
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1])
  }
  return parseFloat(parts[0])
}

export function formatSecondsToTime(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(2).padStart(5, '0')
    return `${mins}:${secs}`
  }
  return seconds.toFixed(2)
}
