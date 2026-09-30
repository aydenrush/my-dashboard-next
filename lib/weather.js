export function fmtHour(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const disp = hour % 12 || 12;
  return `${disp} ${period}`;
}

export function weatherCategory(tempF) {
  if (tempF >= 85) return "hot";
  if (tempF >= 70) return "warm";
  if (tempF >= 55) return "mild";
  if (tempF >= 40) return "cool";
  return "cold";
}

export function bestRunHour(temps, humids, precip, nowHour, { deadline = 21, apparent, dewpoint } = {}) {
  let bestHour = null;
  let bestScore = Infinity;
  for (let hi = Math.max(nowHour, 5); hi <= Math.min(deadline, temps.length - 1); hi++) {
    const t = apparent?.[hi] ?? temps[hi];
    const dp = dewpoint?.[hi] ?? null;
    const p = precip[hi] ?? 0;
    const dpPenalty = dp !== null ? Math.max(0, dp - 55) * 1.5 : humids[hi] * 0.7;
    const score = Math.abs(t - 65) + dpPenalty + p * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestHour = hi;
    }
  }
  return bestHour;
}

export function bestOutdoorHour(temps, humids, precip, nowHour, { earliest = 6, latest = 21, apparent } = {}) {
  let bestHour = null;
  let bestScore = Infinity;
  for (let hi = Math.max(nowHour, earliest); hi <= Math.min(latest, temps.length - 1); hi++) {
    const t = apparent?.[hi] ?? temps[hi];
    const h = humids[hi];
    const p = precip[hi] ?? 0;
    const score = Math.abs(t - 72) + h * 0.5 + p * 0.3;
    if (score < bestScore) {
      bestScore = score;
      bestHour = hi;
    }
  }
  return bestHour;
}
