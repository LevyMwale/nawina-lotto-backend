import { SpinWheelService } from '../services/games/spin-wheel.service';
import { DiceRollService } from '../services/games/dice-roll.service';
import { LottoService } from '../services/games/lotto.service';

export class GameTester {
  /**
   * Test Spin the Wheel game multiple times
   */
  static async testSpinWheel(userId: string, iterations = 100) {
    const service = new SpinWheelService();
    const results = {
      lose: 0,
      small: 0,
      medium: 0,
      big: 0,
      jackpot: 0,
    };

    let totalStaked = 0;
    let totalPayout = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        const result = await service.play(userId, 10);
        results[result.outcome as keyof typeof results]++;
        totalStaked += result.stake;
        totalPayout += result.payout;
      } catch (error) {
        console.error('Test failed:', error);
      }
    }

    return {
      iterations,
      results,
      totalStaked,
      totalPayout,
      houseEdge: ((totalStaked - totalPayout) / totalStaked) * 100,
      rtp: (totalPayout / totalStaked) * 100,
    };
  }

  /**
   * Test Dice Roll game
   */
  static async testDiceRoll(userId: string, betType: 'exact' | 'even_odd' | 'high_low', iterations = 100) {
    const service = new DiceRollService();
    let wins = 0;
    let totalStaked = 0;
    let totalPayout = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        let bet;
        if (betType === 'exact') {
          bet = { type: betType, prediction: 3 };
        } else if (betType === 'even_odd') {
          bet = { type: betType, prediction: 'even' };
        } else {
          bet = { type: betType, prediction: 'high' };
        }

        const result = await service.play(userId, 10, bet);
        if (result.won) wins++;
        totalStaked += result.stake;
        totalPayout += result.payout;
      } catch (error) {
        console.error('Test failed:', error);
      }
    }

    return {
      betType,
      iterations,
      wins,
      winRate: (wins / iterations) * 100,
      totalStaked,
      totalPayout,
      rtp: (totalPayout / totalStaked) * 100,
    };
  }
}