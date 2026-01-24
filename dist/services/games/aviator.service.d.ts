export declare class SpinWheelService {
    private walletService;
    private rngService;
    constructor();
    /**
     * Play Spin the Wheel game
     */
    play(userId: string, stake: number): Promise<{
        success: boolean;
        game_id: string;
        outcome: string;
        label: string;
        multiplier: number;
        stake: number;
        payout: number;
        balance: number;
        seed: string;
    }>;
    /**
     * Determine outcome based on probability distribution
     */
    private determineOutcome;
    /**
     * Get game configuration (with caching)
     */
    private getConfig;
    /**
     * Get game statistics (for admin)
     */
    getStats(limit?: number): Promise<{
        total_plays: number;
        total_staked: number;
        total_payout: number;
        house_profit: number;
        house_edge: number;
    }>;
}
//# sourceMappingURL=aviator.service.d.ts.map