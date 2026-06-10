import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { SpinWheelService } from '../services/games/spin-wheel.service';
import { DiceRollService } from '../services/games/dice-roll.service';
import { LottoService } from '../services/games/lotto.service';
import { AviatorService } from '../services/games/aviator.service';
import { QuizService } from '../services/games/quiz.service';
import { SoccerService, type LeagueCode } from '../services/games/soccer.service';
import { BlackjackService } from '../services/games/blackjack.service';
import { HourlyDrawService } from '../services/games/hourly-draw.service';
import { GamePlay } from '../models/GamePlay';
import { Transaction } from '../models/Transaction';

const router = Router();

// All game routes require authentication
router.use(authenticate);

// Initialize services
const spinWheelService = new SpinWheelService();
const diceRollService = new DiceRollService();
const lottoService = new LottoService();
const aviatorService = new AviatorService();
const quizService = new QuizService();
const soccerService = new SoccerService();
const blackjackService = new BlackjackService();
const hourlyDrawService = new HourlyDrawService();

// ============================================
// SPIN THE WHEEL
// ============================================
router.post('/spin/play', async (req: AuthRequest, res) => {
  try {
    const { stake } = req.body;

    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }

    const result = await spinWheelService.play(req.userId!, Number(stake));
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// DICE ROLL
// ============================================
router.post('/dice/play', async (req: AuthRequest, res) => {
  try {
    const { stake, bet } = req.body;

    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }

    if (!bet || !bet.type || bet.prediction === undefined) {
      return res.status(400).json({ error: 'Valid bet is required' });
    }

    const result = await diceRollService.play(req.userId!, Number(stake), bet);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// LOTTO (PICK NUMBERS)
// ============================================
router.post('/lotto/play', async (req: AuthRequest, res) => {
  try {
    const { variant, numbers } = req.body;

    if (!variant || !['pick3', 'pick5'].includes(variant)) {
      return res.status(400).json({ error: 'Valid variant is required (pick3 or pick5)' });
    }

    if (!Array.isArray(numbers)) {
      return res.status(400).json({ error: 'Numbers must be an array' });
    }

    const result = await lottoService.play(req.userId!, { variant, numbers });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// AVIATOR (TAMANGA)
// ============================================
//
// Round-based flow:
//   1. POST /aviator/round      → returns the crash point (no wallet change)
//   2. POST /aviator/settle     → settles a round after cashout or crash
//
// The legacy POST /aviator/play is kept for backwards-compat (it does the
// full play in one call when the client doesn't do real-time cashout).
// ============================================

router.post('/aviator/round', async (req: AuthRequest, res) => {
  try {
    const { stake } = req.body;
    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }
    const result = await aviatorService.startRound(req.userId!, Number(stake));
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/aviator/settle', async (req: AuthRequest, res) => {
  try {
    const { stake, multiplier, crash_point, round_id } = req.body;
    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }
    if (typeof crash_point !== 'number' || crash_point <= 1) {
      return res.status(400).json({ error: 'Valid crash point is required' });
    }
    if (!round_id) {
      return res.status(400).json({ error: 'round_id is required' });
    }
    // multiplier of 0 (or missing) means the player crashed out without cashing out.
    const cashOut = Number(multiplier) || 0;
    const result = await aviatorService.settle(
      req.userId!,
      Number(stake),
      cashOut,
      Number(crash_point),
      String(round_id),
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/aviator/play', async (req: AuthRequest, res) => {
  try {
    const { stake, multiplier } = req.body;

    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }

    // multiplier is the cash-out multiplier the player claims to have
    // reached. 0 or missing = crashed out (lost).
    const cashOut = Number(multiplier) || 0;

    const result = await aviatorService.play(req.userId!, Number(stake), cashOut);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// TRIVIA QUIZ
// ============================================
router.post('/quiz/play', async (req: AuthRequest, res) => {
  try {
    const { stake } = req.body;

    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }

    const result = await quizService.play(req.userId!, Number(stake));
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// BLACKJACK
// ============================================
//
// Multi-action flow: deal → (hit | stand | double)* → settled.
// Body shape: { stake, action: 'deal'|'hit'|'stand'|'double', gameId? }
// The same /play endpoint handles every action so the client doesn't have
// to juggle a router. `gameId` is required for everything except 'deal'.
// ============================================
router.post('/blackjack/play', async (req: AuthRequest, res) => {
  try {
    const { stake, action, gameId } = req.body || {};
    if (!stake || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }
    if (!action || !['deal', 'hit', 'stand', 'double'].includes(action)) {
      return res.status(400).json({ error: 'Valid action is required (deal, hit, stand, double)' });
    }
    const result = await blackjackService.play(req.userId!, Number(stake), action, gameId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// SOCCER QUIZ
// ============================================
//
// The lobby widget + question-preview endpoints are PUBLIC (no auth) so
// the fixture list can render before login. The actual stake-bearing
// /play endpoint below IS auth'd (this whole router is under authenticate).
// ============================================
router.post('/soccer-quiz/play', async (req: AuthRequest, res) => {
  try {
    const { fixture, selectedIndex, stake } = req.body || {};
    if (!fixture || typeof fixture !== 'object') {
      return res.status(400).json({ error: 'Fixture is required' });
    }
    if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 3) {
      return res.status(400).json({ error: 'Valid selectedIndex (0-3) is required' });
    }
    if (typeof stake !== 'number' || stake <= 0) {
      return res.status(400).json({ error: 'Valid stake is required' });
    }

    const result = await soccerService.play(
      req.userId!,
      {
        id: Number(fixture.id),
        competitionCode: fixture.competitionCode as LeagueCode,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
      },
      selectedIndex,
      stake,
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// GAME HISTORY
// ============================================
router.get('/history', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const gameType = req.query.game_type as string;

    let query = GamePlay.query()
      .where({ user_id: req.userId! })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (gameType) {
      query = query.where({ game_type: gameType });
    }

    const plays = await query;

    res.json({
      total: plays.length,
      games: plays.map(play => ({
        id: play.id,
        game_type: play.game_type,
        stake: Number(play.stake),
        payout: Number(play.payout),
        result: play.result,
        created_at: play.created_at,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// HOURLY DRAW (RAFFLE)
// ============================================
router.post('/hourly/ticket', async (req: AuthRequest, res) => {
  try {
    const { draw_id, count } = req.body;
    if (!draw_id) {
      return res.status(400).json({ error: 'draw_id is required' });
    }
    const ticketCount = Math.max(1, Math.min(100, parseInt(count) || 1));
    const result = await hourlyDrawService.buyTicket(req.userId!, draw_id, ticketCount);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/hourly/current', async (req: AuthRequest, res) => {
  try {
    const result = await hourlyDrawService.getCurrentDraw(req.userId!);
    res.json({
      draw: result.draw,
      total_entries: result.total_entries,
      user_tickets: result.user_tickets,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/hourly/history', async (_req, res) => {
  try {
    const result = await hourlyDrawService.getDrawHistory();
    res.json({
      draws: result.draws.map((d) => ({
        id: d.id,
        scheduled_at: d.scheduled_at,
        status: d.status,
        ticket_price: Number(d.ticket_price),
        total_pool: Number(d.total_pool),
        prize_pool: Number(d.prize_pool),
        winner_user_id: d.winner_user_id,
        winning_ticket_number: d.winning_ticket_number,
        completed_at: d.completed_at,
      })),
      total: result.total,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// VERIFY GAME (Provably Fair)
// ============================================
router.get('/verify/:gameId', async (req: AuthRequest, res) => {
  try {
    const gamePlay = await GamePlay.query()
      .findById(req.params.gameId)
      .where({ user_id: req.userId! });

    if (!gamePlay) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // User can verify the game was fair using the seed
    res.json({
      game_id: gamePlay.id,
      game_type: gamePlay.game_type,
      rng_seed: gamePlay.rng_seed,
      result: gamePlay.result,
      payout: Number(gamePlay.payout),
      message: 'Use this seed to verify the game outcome was random and fair',
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// LEADERBOARD — real top winners (live data)
// ============================================
router.get('/leaderboard', async (_req, res) => {
  try {
    const knex = Transaction.knex();
    const limit = Math.min(50, parseInt((_req as any).query.limit as string) || 10);

    // 1. Sum all 'win' + 'bonus' transactions per user
    const winRows = await knex.raw(`
      SELECT
        u.id AS user_id,
        COALESCE(u.full_name, u.phone) AS name,
        SUM(t.amount) AS winnings,
        COUNT(t.id) AS games
      FROM transactions t
      JOIN wallets w ON w.id = t.wallet_id
      JOIN users u ON u.id = w.user_id
      WHERE t.type IN ('win', 'bonus')
        AND t.status = 'completed'
      GROUP BY u.id, u.full_name, u.phone
      ORDER BY winnings DESC
      LIMIT ?
    `, [limit]);

    // 2. Hourly draw winners (jackpot wins)
    const drawRows = await knex.raw(`
      SELECT
        u.id AS user_id,
        COALESCE(u.full_name, u.phone) AS name,
        SUM(hd.prize_pool) AS winnings,
        COUNT(hd.id) AS games
      FROM hourly_draws hd
      JOIN users u ON u.id = hd.winner_user_id
      WHERE hd.status = 'completed'
        AND hd.winner_user_id IS NOT NULL
      GROUP BY u.id, u.full_name, u.phone
      ORDER BY winnings DESC
      LIMIT ?
    `, [limit]);

    // 3. Merge and deduplicate by user_id
    const map = new Map<string, { rank: number; name: string; winnings: number; games: number }>();
    for (const r of winRows.rows || []) {
      map.set(r.user_id, {
        rank: 0,
        name: r.name,
        winnings: Number(r.winnings || 0),
        games: Number(r.games || 0),
      });
    }
    for (const r of drawRows.rows || []) {
      const existing = map.get(r.user_id);
      if (existing) {
        existing.winnings += Number(r.winnings || 0);
        existing.games += Number(r.games || 0);
      } else {
        map.set(r.user_id, {
          rank: 0,
          name: r.name,
          winnings: Number(r.winnings || 0),
          games: Number(r.games || 0),
        });
      }
    }

    // 4. Sort, assign ranks, and return
    const entries = Array.from(map.values())
      .sort((a, b) => b.winnings - a.winnings)
      .slice(0, limit)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    res.json({ entries });
  } catch (error: any) {
    console.error('[Leaderboard] error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;