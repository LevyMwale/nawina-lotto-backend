"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LottoService = void 0;
const objection_1 = require("objection");
const wallet_service_1 = require("../wallet.service");
const rng_service_1 = require("../rng.service");
const GamePlay_1 = require("../../models/GamePlay");
const LOTTO_CONFIG = {
    pick3: {
        count: 3,
        range: [0, 9],
        jackpot: 5000,
        payouts: {
            3: 5000, // Match all 3
            2: 100, // Match 2
            1: 10, // Match 1
        },
        stake: 10,
    },
    pick5: {
        count: 5,
        range: [1, 50],
        jackpot: 100000,
        payouts: {
            5: 100000, // Match all 5
            4: 5000, // Match 4
            3: 500, // Match 3
            2: 50, // Match 2
        },
        stake: 20,
    },
};
class LottoService {
    constructor() {
        this.walletService = new wallet_service_1.WalletService();
        this.rngService = new rng_service_1.RNGService();
    }
    /**
     * Play Pick Numbers Lotto
     */
    async play(userId, bet) {
        const config = LOTTO_CONFIG[bet.variant];
        const stake = config.stake;
        // Validate numbers
        this.validateNumbers(bet.numbers, bet.variant);
        return await (0, objection_1.transaction)(GamePlay_1.GamePlay.knex(), async (trx) => {
            // 1. Deduct stake
            await this.walletService.deduct(userId, stake, 'bet', {
                game_type: `lotto_${bet.variant}`,
                numbers: bet.numbers,
            });
            // 2. Draw winning numbers
            const { seed, winningNumbers } = this.drawNumbers(bet.variant);
            // 3. Calculate matches and payout
            const matches = this.countMatches(bet.numbers, winningNumbers);
            const payout = config.payouts[matches] || 0; // This will now work
            // 4. Credit winnings
            if (payout > 0) {
                await this.walletService.credit(userId, payout, 'win', {
                    game_type: `lotto_${bet.variant}`,
                    matches,
                });
            }
            // 5. Save game play
            const gamePlay = await GamePlay_1.GamePlay.query(trx).insert({
                user_id: userId,
                game_type: `lotto_${bet.variant}`,
                stake,
                bet_data: { numbers: bet.numbers },
                result: {
                    winning_numbers: winningNumbers,
                    user_numbers: bet.numbers,
                    matches,
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
    validateNumbers(numbers, variant) {
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
    drawNumbers(variant) {
        const config = LOTTO_CONFIG[variant];
        const [min, max] = config.range;
        const { seed, random } = this.rngService.generateRandom();
        // Use seed to generate deterministic sequence
        const rng = require('seedrandom')(seed);
        const numbers = [];
        const used = new Set();
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
    countMatches(userNumbers, winningNumbers) {
        const winningSet = new Set(winningNumbers);
        return userNumbers.filter(num => winningSet.has(num)).length;
    }
}
exports.LottoService = LottoService;
//# sourceMappingURL=lotto.service.js.map