export const ROUND_ORDER = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "UDFA"];

export const AWARD_COLS = {
  sb_winner: "SB Winner", sb_mvp: "SB MVP", nfl_mvp: "NFL MVP",
  coach_of_year: "Coach of Year", opoy: "OPOY", dpoy: "DPOY",
  oroy: "OROY", droy: "DROY",
};

export const SEASON_DISPLAY_COLS = [
  "year", "sb_winner", "sb_mvp", "nfl_mvp", "coach_of_year",
  "opoy", "dpoy", "oroy", "droy", "ninety_nine_club",
];

export const SEASON_COL_NAMES = {
  year: "Year", sb_winner: "SB Winner", sb_mvp: "SB MVP",
  nfl_mvp: "NFL MVP", coach_of_year: "Coach of Year",
  opoy: "OPOY", dpoy: "DPOY", oroy: "OROY", droy: "DROY",
  ninety_nine_club: "99 Club",
};

export const NFL_DIVISIONS = {
  "AFC East": ["BUF", "MIA", "NE", "NYJ"],
  "AFC North": ["BAL", "CIN", "CLE", "PIT"],
  "AFC South": ["HOU", "IND", "JAX", "TEN"],
  "AFC West": ["DEN", "KC", "LAC", "LV"],
  "NFC East": ["DAL", "NYG", "PHI", "WAS"],
  "NFC North": ["CHI", "DET", "GB", "MIN"],
  "NFC South": ["ATL", "CAR", "NO", "TB"],
  "NFC West": ["ARI", "LAR", "SEA", "SF"],
};

export const ALL_DIV_TEAMS = Object.values(NFL_DIVISIONS).flat();

export const AP_POSITIONS_OFF = [
  "QB 1st", "QB 2nd", "RB 1st", "RB 2nd", "RB 3rd",
  "FB 1st", "FB 2nd", "WR 1st", "WR 2nd", "WR 3rd", "WR 4th", "WR 5th",
  "TE 1st", "TE 2nd", "OT 1st", "OT 2nd", "OT 3rd",
  "OG 1st", "OG 2nd", "OG 3rd", "C 1st", "C 2nd",
];
export const AP_POSITIONS_DEF = [
  "EDGE 1st", "EDGE 2nd", "EDGE 3rd", "EDGE 4th", "EDGE 5th", "EDGE 6th",
  "DT 1st", "DT 2nd", "DT 3rd", "DT 4th",
  "SAM 1st", "SAM 2nd", "MIKE 1st", "MIKE 2nd", "MIKE 3rd",
  "WILL 1st", "WILL 2nd",
  "CB 1st", "CB 2nd", "CB 3rd", "CB 4th", "CB 5th",
  "S 1st", "S 2nd", "S 3rd",
];
export const AP_POSITIONS_ST = ["K 1st", "K 2nd", "P 1st", "P 2nd", "KR 1st", "PR 1st", "LS 1st"];
export const AP_POSITIONS_ALL = [...AP_POSITIONS_OFF, ...AP_POSITIONS_DEF, ...AP_POSITIONS_ST];

export const CLASS_AGE = {
  FR: 19, SO: 20, JR: 21, SR: 22,
  "FR(RS)": 20, "SO(RS)": 21, "JR(RS)": 22, "SR(RS)": 23,
  "RS FR": 20, "RS SO": 21, "RS JR": 22, "RS SR": 23,
};

export function ageFromClass(cls) {
  if (!cls) return null;
  return CLASS_AGE[cls.trim().toUpperCase()] ?? null;
}

export function apDisplayLabel(pos) {
  const ordinals = new Set(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"]);
  const parts = pos.split(" ");
  if (parts.length === 2 && ordinals.has(parts[1])) return parts[0];
  return pos;
}

export const ACTIVITY_TYPES = {
  running: { label: "Running", color: "#F44336" },
  lifting: { label: "Lifting", color: "#FF9800" },
  cycling: { label: "Cycling", color: "#4CAF50" },
  frisbee_golf: { label: "Frisbee Golf", color: "#2196F3" },
  rap_writing: { label: "Rap Writing", color: "#9C27B0" },
  other: { label: "Other", color: "#607D8B" },
};

export const PRIORITY_COLORS = { high: "#F44336", medium: "#FF9800", low: "#4CAF50" };
