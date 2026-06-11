import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { GameConfig } from '../../models/GameConfig';
import { HousePoolService } from './house-pool.service';

type LottoVariant = 'pick3' | 'pick5';

interface LottoBet {
  variant: LottoVariant;
  numbers: number[];
  stake: number;
}

interface LottoVariantConfig {
  count: number;
  range: [number, number];
  // Multipliers applied to stake for each match count
  multipliers: Record<number, number>;
}

const LOTTO_CONFIG: Record<LottoVariant, LottoVariantConfig> = {
  pick3: {
    count: 3,
    range: [1, 10], // matches frontend grid (numbers 1-10)
    multipliers: {
      3: 500,   // 500× stake
      2: 10,    // 10× stake
      1: 1,     // 1× stake (break-even)
    },
  },
  pick5: {
    count: 5,
    range: [1, 20], // matches frontend grid (numbers 1-20)
    multipliers: {
      5: 5000,  // 5000× stake
      4: 250,   // 250× stake
      3: 25,    // 25× stake
      2: 2.5,   // 2.5× stake
    },
  },
};

export class LottoService {
  private walletService: WalletService;
  private rngService: RNGService;
  private housePoolService: HousePoolService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
    this.housePoolService = new HousePoolService();
  }

  /**
   * Play Pick Numbers Lotto
   */
  async play(userId: string, bet: LottoBet) {
    const config = LOTTO_CONFIG[bet.variant];
    const stake = Number(bet.stake) || 2;

    // Validate stake against game config
    const dbConfig = await GameConfig.query()
      .findOne({ game_type: `lotto_${bet.variant}`, is_active: true });
    const minStake = Number(dbConfig?.min_stake) || 2;
    const maxStake = Number(dbConfig?.max_stake) || 10000;
    if (stake < minStake) {
      throw new Error(`Minimum stake is K${minStake}`);
    }
    if (stake > maxStake) {
      throw new Error(`Maximum stake is K${maxStake}`);
    }

    // Validate numbers
    this.validateNumbers(bet.numbers, bet.variant);

    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Deduct stake
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: `lotto_${bet.variant}`,
        numbers: bet.numbers,
        stake,
      });

      // 2. Draw winning numbers
      const { seed, winningNumbers } = this.drawNumbers(bet.variant);

      // 3. Calculate matches and payout (proportional to stake)
      const matches = this.countMatches(bet.numbers, winningNumbers);
      const multiplier = config.multipliers[matches] || 0;
      let payout = round2(stake * multiplier);

      // 3b. Global house pool enforcement — cap to budget, never force to zero
      payout = await this.housePoolService.capPayout(payout);

      // 4. Credit winnings
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: `lotto_${bet.variant}`,
          matches,
          stake,
          multiplier,
        });
      }

      // 5. Save game play
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: `lotto_${bet.variant}`,
        stake,
        bet_data: { numbers: bet.numbers, stake },
        result: {
          winning_numbers: winningNumbers,
          user_numbers: bet.numbers,
          matches,
          multiplier,
        },
        payout,
        rng_seed: seed,
      });

      // 6. Get balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        success: true,
        game_id: gamePlay.id,
        variant: bet.variant,
        user_numbers: bet.numbers,
        winning_numbers: winningNumbers,
        matches,
        stake,
        payout,
        balance: walletInfo.balance,
        seed,
      };
    });
  }

  /**
   * Validate user's number selection
   */
  private validateNumbers(numbers: number[], variant: LottoVariant) {
    const config = LOTTO_CONFIG[variant];

    if (numbers.length !== config.count) {
      throw new Error(`Must pick exactly ${config.count} numbers`);
    }

    const [min, max] = config.range;
    for (const num of numbers) {
      if (num < min || num > max) {
        throw new Error(`Numbers must be between ${min} and ${max}`);
      }
    }

    // Check for duplicates
    if (new Set(numbers).size !== numbers.length) {
      throw new Error('Cannot pick duplicate numbers');
    }
  }

  /**
   * Draw random winning numbers
   */
  private drawNumbers(variant: LottoVariant): { seed: string; winningNumbers: number[] } {
    const config = LOTTO_CONFIG[variant];
    const [min, max] = config.range;
    const { seed, random } = this.rngService.generateRandom();

    // Use seed to generate deterministic sequence
    const rng = require('seedrandom')(seed);
    const numbers: number[] = [];
    const used = new Set<number>();

    while (numbers.length < config.count) {
      const num = Math.floor(rng() * (max - min + 1)) + min;
      if (!used.has(num)) {
        numbers.push(num);
        used.add(num);
      }
    }

    return { seed, winningNumbers: numbers.sort((a, b) => a - b) };
  }

  /**
   * Count matching numbers
   */
  private countMatches(userNumbers: number[], winningNumbers: number[]): number {
    const winningSet = new Set(winningNumbers);
    return userNumbers.filter(num => winningSet.has(num)).length;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}