// 🎮 Mini Manager ball tizimi (texnik topshiriq 13.4). Sof funksiya — testlanadi.
const POINTS = {
  winner: 10,
  exactScore: 30,
  scorer: 15,
  assist: 10,
  red: 10,
  yellow: 5,
  lineupPlayer: 2,
};
const NONE = 0; // "bo'lmaydi"

/** Bitta jamoa bo'yicha voqea taxmini: pred = null (taxmin yo'q) | 0 (bo'lmaydi) | playerId */
function evalEvent(pred, actualIds, knownEmpty) {
  if (pred === null || pred === undefined) return false;
  if (actualIds === null) {
    // Batafsil ma'lumot yo'q: faqat "bo'lmaydi" + aniq bo'lmagani ma'lum bo'lsa
    return Number(pred) === NONE && knownEmpty;
  }
  if (Number(pred) === NONE) return actualIds.length === 0;
  return actualIds.includes(Number(pred));
}

function score(pred, r) {
  const b = {};
  const actualWinner = r.homeGoals > r.awayGoals ? 'HOME' : r.homeGoals < r.awayGoals ? 'AWAY' : 'DRAW';
  b.winner = pred.predicted_winner === actualWinner ? POINTS.winner : 0;
  b.exactScore = Number(pred.predicted_score_home) === r.homeGoals && Number(pred.predicted_score_away) === r.awayGoals ? POINTS.exactScore : 0;

  for (const side of ['home', 'away']) {
    const teamId = side === 'home' ? r.homeId : r.awayId;
    const teamGoals = side === 'home' ? r.homeGoals : r.awayGoals;
    const goalsFor = r.goals ? r.goals.filter((g) => g.teamId === teamId && !g.own) : null;
    const scorerIds = goalsFor ? goalsFor.map((g) => g.scorerId).filter(Boolean) : null;
    const assistIds = goalsFor ? goalsFor.map((g) => g.assistId).filter(Boolean) : null;
    const teamBookings = r.bookings ? r.bookings.filter((x) => x.teamId === teamId) : null;
    const reds = teamBookings ? teamBookings.filter((x) => x.card === 'RED' || x.card === 'YELLOW_RED').map((x) => x.playerId) : null;
    const yellows = teamBookings ? teamBookings.filter((x) => x.card === 'YELLOW' || x.card === 'YELLOW_RED').map((x) => x.playerId) : null;

    b[`scorer_${side}`] = evalEvent(pred[`scorer_${side}`], scorerIds, teamGoals === 0) ? POINTS.scorer : 0;
    b[`assist_${side}`] = evalEvent(pred[`assist_${side}`], assistIds, teamGoals === 0) ? POINTS.assist : 0;
    b[`red_${side}`] = evalEvent(pred[`red_card_${side}`], reds, false) ? POINTS.red : 0;
    b[`yellow_${side}`] = evalEvent(pred[`yellow_card_${side}`], yellows, false) ? POINTS.yellow : 0;

    const actualLineup = side === 'home' ? r.lineupHome : r.lineupAway;
    const predLineup = (pred[`lineup_${side}`] || []).map(Number);
    const hits = actualLineup ? predLineup.filter((id) => actualLineup.includes(id)).length : 0;
    b[`lineup_${side}`] = Math.min(11, hits) * POINTS.lineupPlayer;
  }
  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return { total, breakdown: b };
}

// Natija formati (football.matchResult): { homeId, awayId, homeGoals, awayGoals,
//   goals: [{ teamId, scorerId, assistId, own }] | null, bookings: [{ teamId, playerId, card }] | null,
//   lineupHome: [id] | null, lineupAway: [id] | null }
module.exports = { POINTS, NONE, score };
