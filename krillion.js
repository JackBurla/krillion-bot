const TIMEZONE      = 'America/New_York';
const EPOCH_DATE    = '2026-07-16';
const MAX_SCORE     = 700;
const DAILY_MEDALS  = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
const MEDAL_NAMES   = ['gold', 'silver', 'bronze'];

// ── Dates / puzzle numbers (mirrors krillion.io: day 1 = 2026-07-16 ET) ──

function todayEST(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function puzzleForDate(dateStr) {
  return Math.round((toUTC(dateStr) - toUTC(EPOCH_DATE)) / 864e5) + 1;
}

function dateForPuzzle(puzzleNum) {
  return new Date(toUTC(EPOCH_DATE) + (puzzleNum - 1) * 864e5).toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Parsing ───────────────────────────────────────────────────────────────

// Daily shares are "Krillion #93 🦐"; archive ("Krillion ⟲ #") and unlimited
// ("Krillion ∞ #") shares intentionally don't match.
const POST_RE = /Krillion #(\d+)[^\n]*\n\s*(\d+)[ \t]*(?:\n\s*([^\n]+))?/i;

function parsePost(content, todayPuzzle = puzzleForDate(todayEST())) {
  const match = content.match(POST_RE);
  if (!match) return null;
  const puzzleNum = parseInt(match[1], 10);
  const score     = parseInt(match[2], 10);
  if (puzzleNum < 1 || puzzleNum > todayPuzzle) return null;
  if (score < 0 || score > MAX_SCORE) return null;
  const tilesLine = (match[3] || '').trim();
  const tiles = tilesLine && !/https?:|\d/.test(tilesLine) ? tilesLine.replace(/\s+/g, '') : null;
  return { puzzleNum, score, tiles, dateStr: dateForPuzzle(puzzleNum) };
}

// ── Medals ────────────────────────────────────────────────────────────────

function assignMedals(sorted) {
  if (!sorted.length) return [];
  const results = [];
  let medalIdx = 0, i = 0;
  while (i < sorted.length && medalIdx < MEDAL_NAMES.length) {
    const currentScore = sorted[i].score;
    let j = i;
    while (j < sorted.length && sorted[j].score === currentScore) j++;
    const tieCount = j - i;
    const medal = MEDAL_NAMES[medalIdx];
    for (let k = i; k < j; k++) results.push({ ...sorted[k], medal });
    medalIdx += tieCount >= 2 ? 2 : 1;
    i = j;
  }
  return results;
}

function tallyMedals(rows) {
  const byPuzzle = {};
  for (const s of rows) (byPuzzle[s.puzzle_num] ||= []).push(s);
  const tally = {};
  for (const dayRows of Object.values(byPuzzle)) {
    const sorted = dayRows.slice().sort((a, b) => b.score - a.score);
    for (const m of assignMedals(sorted)) {
      tally[m.user_id] ||= { username: m.username, gold: 0, silver: 0, bronze: 0 };
      tally[m.user_id][m.medal]++;
      tally[m.user_id].username = m.username;
    }
  }
  return Object.values(tally)
    .sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze);
}

// ── Recap ─────────────────────────────────────────────────────────────────

function buildRecap({ puzzleNum, dayRows, allTimeTop, medalTally }) {
  const fields = [];

  if (dayRows.length) {
    const sorted = dayRows.slice().sort((a, b) => b.score - a.score);
    const lines = assignMedals(sorted).map(m => {
      const tiles = m.tiles ? ` ${m.tiles}` : '';
      return `${DAILY_MEDALS[MEDAL_NAMES.indexOf(m.medal)]} **${m.username}** - ${m.score} pts${tiles}`;
    });
    const avg = Math.round(dayRows.reduce((sum, s) => sum + s.score, 0) / dayRows.length);
    lines.push('', `Average: ${avg} pts (${dayRows.length} player${dayRows.length !== 1 ? 's' : ''})`);
    fields.push({ name: 'Top 3', value: lines.join('\n') });
  } else {
    fields.push({ name: 'Top 3', value: '_No scores recorded_' });
  }

  fields.push({
    name: 'Highest Scores Ever',
    value: allTimeTop.length
      ? allTimeTop.map((r, i) => `${i + 1}. **${r.username}** - ${r.score} pts on #${r.puzzle_num}`).join('\n')
      : '_No data yet_'
  });

  fields.push({
    name: 'Medal Standings',
    value: medalTally.length
      ? medalTally.slice(0, 10).map(r => {
          const parts = [];
          if (r.gold)   parts.push(`${DAILY_MEDALS[0]}${r.gold}`);
          if (r.silver) parts.push(`${DAILY_MEDALS[1]}${r.silver}`);
          if (r.bronze) parts.push(`${DAILY_MEDALS[2]}${r.bronze}`);
          return `**${r.username}** - ${parts.join(' ')}`;
        }).join('\n')
      : '_No data yet_'
  });

  return {
    title: `Krillion #${puzzleNum} Recap \u{1F990}`,
    footer: formatDate(dateForPuzzle(puzzleNum)),
    fields
  };
}

module.exports = {
  EPOCH_DATE,
  TIMEZONE,
  assignMedals,
  buildRecap,
  dateForPuzzle,
  formatDate,
  parsePost,
  puzzleForDate,
  tallyMedals,
  todayEST
};
