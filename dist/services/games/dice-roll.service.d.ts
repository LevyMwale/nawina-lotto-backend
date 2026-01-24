type BetType = 'exact' | 'even_odd' | 'high_low';
interface DiceBet {
    type: BetType;
    prediction: number | string;
}
export declare class DiceRollService {
    private walletService;
    private rngService;
    constructor();
    /**
     * Play Dice Roll game
     */
    play(userId: string, stake: number, bet: DiceBet): Promise<{
        success: boolean;
        game_id: string;
        roll: number;
        won: boolean;
        multiplier: number;
        stake: number;
        payout: number;
        balance: number;
        seed: string;
    }>;
    /**
     * Validate bet structure
     */
    private validateBet;
    /**
     * Check if bet won
     */
    private checkWin;
}
export {};
//# sourceMappingURL=dice-roll.service.d.ts.map