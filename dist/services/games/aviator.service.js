"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpinWheelService = void 0;
const objection_1 = require("objection");
const wallet_service_1 = require("../wallet.service");
const rng_service_1 = require("../rng.service");
const GamePlay_1 = require("../../models/GamePlay");
const GameConfig_1 = require("../../models/GameConfig");
const DEFAULT_SPIN_CONFIG = {
    outcomes: {
        lose: { probability: 0.50, multiplier: 0, label: 'Try Again' },
        small: { probability: 0.25, multiplier: 1, label: '1x Win' },
        medium: { probability: 0.15, multiplier: 2, label: '2x Win' },
        big: { probability: 0.08, multiplier: 5, label: '5x Win' },
        jackpot: { probability: 0.02, multiplier: 50, label: 'JACKPOT!' },
    },
    minStake: 5,
    maxStake: 100,
};
class SpinWheelService {
    constructor() {
        this.walletService = new wallet_service_1.WalletService();
        this.rngService = new rng_service_1.RNGService();
    }
    /**
     * Play Spin the Wheel game
     */
    async play(userId, stake) {
        // Get game configuration
        const config = await this.getConfig();
        // Validate stake
        if (stake < config.minStake || stake > config.maxStake) {
            throw new Error(`Stake must be between K${config.minStake} and K${config.maxStake}`);
        }
        // Execute game in transaction
        return await (0, objection_1.transaction)(GamePlay_1.GamePlay.knex(), async (trx) => {
            // 1. Deduct stake from wallet
            await this.walletService.deduct(userId, stake, 'bet', {
                game_type: 'spin_wheel',
            });
            // 2. Generate outcome
            const { seed, random } = this.rngService.generateRandom();
            const outcome = this.determineOutcome(random, config.outcomes);
            const multiplier = config.outcomes[outcome].multiplier;
            const payout = stake * multiplier;
            // 3. Credit winnings if any
            if (payout > 0) {
                await this.walletService.credit(userId, payout, 'win', {
                    game_type: 'spin_wheel',
                    outcome,
                });
            }
            // 4. Save game play record
            const gamePlay = await GamePlay_1.GamePlay.query(trx).insert({
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
    determineOutcome(random, outcomes) {
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
    async getConfig() {
        const dbConfig = await GameConfig_1.GameConfig.query()
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
        const plays = await GamePlay_1.GamePlay.query()
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
exports.SpinWheelService = SpinWheelService;
//# sourceMappingURL=aviator.service.js.map