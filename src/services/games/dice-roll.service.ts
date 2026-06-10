import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';

type BetType = 'exact' | 'even_odd' | 'high_low';

interface DiceBet {
  type: BetType;
  prediction: number | string; // number for 'exact', 'even'/'odd' for even_odd, 'high'/'low' for high_low
}

const PAYOUT_MULTIPLIERS = {
  exact: 6,
  even_odd: 2,
  high_low: 2,
};

export class DiceRollService {
  private walletService: WalletService;
  private rngService: RNGService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
  }

  /**
   * Play Dice Roll game
   */
  async play(userId: string, stake: number, bet: DiceBet) {
    // Validate stake
    if (stake < 5 || stake > 100) {
      throw new Error('Stake must be between K5 and K100');
    }

    // Validate bet
    this.validateBet(bet);

    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Deduct stake
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'dice_roll',
        bet,
      });

      // 2. Roll dice
      const { seed, value: roll } = this.rngService.generateRandomInt(1, 6);

      // 3. Check if won
      let won = this.checkWin(roll, bet);
      let multiplier = won ? PAYOUT_MULTIPLIERS[bet.type] : 0;
      let payout = stake * multiplier;

      // 3b. Win cap enforcement
      const winCapacity = await this.walletService.getWinCapacity(userId);
      if (payout > winCapacity) {
        console.log(`[DiceRoll] Win cap enforced — user=${userId} would win ${payout} but capacity is ${winCapacity}. Forcing lose.`);
        won = false;
        multiplier = 0;
        payout = 0;
      }

      // 4. Credit winnings
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'dice_roll',
          roll,
          bet,
        });
      }

      // 5. Save game play
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'dice_roll',
        stake,
        bet_data: bet,
        result: {
          roll,
          won,
          bet_type: bet.type,
          prediction: bet.prediction,
        },
        payout,
        rng_seed: seed,
      });

      // 6. Get balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        success: true,
        game_id: gamePlay.id,
        roll,
        won,
        multiplier,
        stake,
        payout,
        balance: walletInfo.balance,
        seed,
      };
    });
  }

  /**
   * Validate bet structure
   */
  private validateBet(bet: DiceBet) {
    if (!['exact', 'even_odd', 'high_low'].includes(bet.type)) {
      throw new Error('Invalid bet type');
    }

    if (bet.type === 'exact') {
      const num = Number(bet.prediction);
      if (!Number.isInteger(num) || num < 1 || num > 6) {
        throw new Error('Exact bet must predict a number between 1 and 6');
      }
    }

    if (bet.type === 'even_odd') {
      if (!['even', 'odd'].includes(bet.prediction as string)) {
        throw new Error('Even/Odd bet must predict "even" or "odd"');
      }
    }

    if (bet.type === 'high_low') {
      if (!['high', 'low'].includes(bet.prediction as string)) {
        throw new Error('High/Low bet must predict "high" (4-6) or "low" (1-3)');
      }
    }
  }

  /**
   * Check if bet won
   */
  private checkWin(roll: number, bet: DiceBet): boolean {
    switch (bet.type) {
      case 'exact':
        return roll === Number(bet.prediction);

      case 'even_odd':
        const isEven = roll % 2 === 0;
        return (bet.prediction === 'even' && isEven) || (bet.prediction === 'odd' && !isEven);

      case 'high_low':
        const isHigh = roll >= 4;
        return (bet.prediction === 'high' && isHigh) || (bet.prediction === 'low' && !isHigh);

      default:
        return false;
    }
  }
}