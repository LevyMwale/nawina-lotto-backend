import { Router } from 'express';
import {
  getLiveMatches,
  getUpcomingMatches,
  getRecentResults,
  generateQuizQuestion,
  LeagueCode,
} from '../services/games/soccer.service';

const router = Router();

// ============================================================================
// Soccer public router
//
// Two purposes:
//   1. Proxy football-data.org for the lobby widget. The frontend used to
//      call api.football-data.org directly from the browser, which hits a
//      CORS error because the free tier doesn't allow cross-origin calls
//      from web origins. Routing through the API server fixes that, and
//      also keeps the API key server-side.
//   2. Generate a quiz question (no auth) so the lobby can show the
//      4-option prompt to the player before they commit a stake. The
//      stake-bearing /play endpoint is in games.routes.ts (auth required).
//
// All endpoints here are public — no authenticate middleware. We rely on
// upstream rate limiting (60s/6h/1h TTL in the service) so we can't be
// trivially used as an open proxy.
// ============================================================================

// ---------------------------------------------------------------------------
// Fixtures
//
// The widget treats an empty list as "nothing to show" (loading state),
// so transient upstream errors (football-data.org rate-limited, network
// hiccup) should return 200 with `data: []` and an `error` field, NOT a
// 500. A 500 stops the widget from re-polling and lights up the console
// with a scary stack — a 200 with an empty list keeps the UI calm and
// the next poll will retry naturally.
//
// The only 500s left are genuine server bugs (unhandled exception),
// which is the right place for them.
// ---------------------------------------------------------------------------
router.get('/matches/live', async (_req, res) => {
  try {
    const matches = await getLiveMatches();
    res.json({ data: matches, fetchedAt: Date.now() });
  } catch (error: any) {
    const msg = error?.message || 'Upstream error';
    // Config-level errors (missing API key) are 500 — operator must fix.
    if (msg.includes('not configured')) {
      return res.status(500).json({ error: msg });
    }
    // eslint-disable-next-line no-console
    console.warn(`[soccer] /matches/live upstream:`, msg);
    res.json({ data: [], fetchedAt: Date.now(), error: msg });
  }
});

router.get('/matches/upcoming', async (_req, res) => {
  try {
    const matches = await getUpcomingMatches();
    res.json({ data: matches, fetchedAt: Date.now() });
  } catch (error: any) {
    const msg = error?.message || 'Upstream error';
    if (msg.includes('not configured')) {
      return res.status(500).json({ error: msg });
    }
    // eslint-disable-next-line no-console
    console.warn(`[soccer] /matches/upcoming upstream:`, msg);
    res.json({ data: [], fetchedAt: Date.now(), error: msg });
  }
});

router.get('/matches/recent', async (_req, res) => {
  try {
    const matches = await getRecentResults();
    res.json({ data: matches, fetchedAt: Date.now() });
  } catch (error: any) {
    const msg = error?.message || 'Upstream error';
    if (msg.includes('not configured')) {
      return res.status(500).json({ error: msg });
    }
    // eslint-disable-next-line no-console
    console.warn(`[soccer] /matches/recent upstream:`, msg);
    res.json({ data: [], fetchedAt: Date.now(), error: msg });
  }
});

// ---------------------------------------------------------------------------
// Quiz question preview
//
// POST /api/soccer/quiz-question
// Body: { id, competitionCode, homeTeam, awayTeam, competition }
// Returns: { prompt, options }
// (deliberately omits correctIndex — the client shouldn't know the answer
// before staking. The /api/games/soccer-quiz/play endpoint re-derives the
// question server-side and validates the player's pick.)
// ---------------------------------------------------------------------------
router.post('/quiz-question', async (req, res) => {
  try {
    const { id, competitionCode, homeTeam, awayTeam, competition } = req.body || {};
    if (!id || !competitionCode || !homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'id, competitionCode, homeTeam and awayTeam are required' });
    }
    const question = await generateQuizQuestion({
      id: Number(id),
      competitionCode: competitionCode as LeagueCode,
      homeTeam,
      awayTeam,
      competition: competition || '',
    });
    // Strip the correctIndex from the public response. The frontend only
    // needs the prompt and the 4 options to display the question.
    const { correctIndex, ...publicQuestion } = question;
    res.json(publicQuestion);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
