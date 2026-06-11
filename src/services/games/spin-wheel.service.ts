import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { GameConfig } from '../../models/GameConfig';
import { HousePoolService } from './house-pool.service';

interface SpinWheelConfig {
  outcomes: {
    [key: string]: {
      probability: number;
      multiplier: number;
      label: string;
    };
  };
  minStake: number;
  maxStake: number;
}

const DEFAULT_SPIN_CONFIG: SpinWheelConfig = {
  outcomes: {
    lose: { probability: 0.50, multiplier: 0, label: 'Try Again' },
    small: { probability: 0.25, multiplier: 1, label: '1x Win' },
    medium: { probability: 0.15, multiplier: 2, label: '2x Win' },
    big: { probability: 0.08, multiplier: 5, label: '5x Win' },
    jackpot: { probability: 0.02, multiplier: 50, label: 'JACKPOT!' },
  },
  minStake: 2,
  maxStake: 100,
};

export class SpinWheelService {
  private walletService: WalletService;
  private rngService: RNGService;
  private housePoolService: HousePoolService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
    this.housePoolService = new HousePoolService();
  }

  /**
   * Play Spin the Wheel game
   */
  async play(userId: string, stake: number) {
    // Get game configuration
    const config = await this.getConfig();

    // Validate stake
    if (stake < config.minStake || stake > config.maxStake) {
      throw new Error(`Stake must be between K${config.minStake} and K${config.maxStake}`);
    }

    // Execute game in transaction
    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Deduct stake from wallet
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'spin_wheel',
      });

      // 2. Generate outcome
      const { seed, random } = this.rngService.generateRandom();
      let outcome = this.determineOutcome(random, config.outcomes);
      let multiplier = config.outcomes[outcome].multiplier;
      let payout = stake * multiplier;

      // 3. Global house pool enforcement — cap to budget, never force to zero
      payout = await this.housePoolService.capPayout(payout);
      if (payout <= 0) {
        outcome = 'lose';
        multiplier = 0;
      }

      // 4. Credit winnings if any
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'spin_wheel',
          outcome,
        });
      }

      // 4. Save game play record
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'spin_wheel',
        stake,
        bet_data: null,
        result: {
          outcome,
          label: config.outcomes[outcome].label,
          multiplier,
        },
        payout,
        rng_seed: seed,
      });

      // 5. Get new balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        success: true,
        game_id: gamePlay.id,
        outcome,
        label: config.outcomes[outcome].label,
        multiplier,
        stake,
        payout,
        balance: walletInfo.balance,
        seed, // For provably fair verification
      };
    });
  }

  /**
   * Determine outcome based on probability distribution
   */
  private determineOutcome(random: number, outcomes: SpinWheelConfig['outcomes']): string {
    let cumulative = 0;

    for (const [key, config] of Object.entries(outcomes)) {
      cumulative += config.probability;
      if (random < cumulative) {
        return key;
      }
    }

    return 'lose'; // Fallback
  }

  /**
   * Get game configuration (with caching)
   */
  private async getConfig(): Promise<SpinWheelConfig> {
    const dbConfig = await GameConfig.query()
      .findOne({ game_type: 'spin_wheel', is_active: true });

    if (dbConfig) {
      return {
        outcomes: dbConfig.odds_config,
        minStake: Number(dbConfig.min_stake),
        maxStake: Number(dbConfig.max_stake),
      };
    }

    return DEFAULT_SPIN_CONFIG;
  }

  /**
   * Get game statistics (for admin)
   */
  async getStats(limit = 100) {
    const plays = await GamePlay.query()
      .where({ game_type: 'spin_wheel' })
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