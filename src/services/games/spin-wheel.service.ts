import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { GameEconomyService } from '../game-economy.service';
import { HousePoolService } from './house-pool.service';

export class SpinWheelService {
  private walletService: WalletService;
  private rngService: RNGService;
  private housePoolService: HousePoolService;
  private gameEconomyService: GameEconomyService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
    this.housePoolService = new HousePoolService();
    this.gameEconomyService = new GameEconomyService();
  }

  /**
   * Play Spin the Wheel game
   */
  async play(userId: string, stake: number) {
    // Get game configuration
    const config = await this.gameEconomyService.getConfig('spin_wheel');

    // Validate stake
    if (stake < config.min_stake || stake > config.max_stake) {
      throw new Error(`Stake must be between K${config.min_stake} and K${config.max_stake}`);
    }

    // Execute game in transaction
    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Deduct stake from wallet
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'spin_wheel',
      });

      // 2. Generate outcome
      const { seed, random } = this.rngService.generateRandom();
      const outcomeObj = this.gameEconomyService.determineOutcome(random, config.outcomes);
      let outcome = outcomeObj.key;
      let multiplier = outcomeObj.multiplier;
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
          label: outcomeObj.label,
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
        label: outcomeObj.label,
        multiplier,
        stake,
        payout,
        balance: walletInfo.balance,
        seed, // For provably fair verification
      };
    });
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