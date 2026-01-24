"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameTester = void 0;
const spin_wheel_service_1 = require("../services/games/spin-wheel.service");
const dice_roll_service_1 = require("../services/games/dice-roll.service");
class GameTester {
    /**
     * Test Spin the Wheel game multiple times
     */
    static async testSpinWheel(userId, iterations = 100) {
        const service = new spin_wheel_service_1.SpinWheelService();
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
                results[result.outcome]++;
                totalStaked += result.stake;
                totalPayout += result.payout;
            }
            catch (error) {
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
    static async testDiceRoll(userId, betType, iterations = 100) {
        const service = new dice_roll_service_1.DiceRollService();
        let wins = 0;
        let totalStaked = 0;
        let totalPayout = 0;
        for (let i = 0; i < iterations; i++) {
            try {
                let bet;
                if (betType === 'exact') {
                    bet = { type: betType, prediction: 3 };
                }
                else if (betType === 'even_odd') {
                    bet = { type: betType, prediction: 'even' };
                }
                else {
                    bet = { type: betType, prediction: 'high' };
                }
                const result = await service.play(userId, 10, bet);
                if (result.won)
                    wins++;
                totalStaked += result.stake;
                totalPayout += result.payout;
            }
            catch (error) {
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
exports.GameTester = GameTester;
//# sourceMappingURL=game-tester.js.map