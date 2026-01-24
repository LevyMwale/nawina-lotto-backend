import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { SpinWheelService } from '../services/games/spin-wheel.service';
import { DiceRollService } from '../services/games/dice-roll.service';
import { LottoService } from '../services/games/lotto.service';
import { GamePlay } from '../models/GamePlay';

const router = Router();

// All game routes require authentication
router.use(authenticate);

// Initialize services
const spinWheelService = new SpinWheelService();
const diceRollService = new DiceRollService();
const lottoService = new LottoService();

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

export default router;