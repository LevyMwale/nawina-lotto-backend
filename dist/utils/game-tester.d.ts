export declare class GameTester {
    /**
     * Test Spin the Wheel game multiple times
     */
    static testSpinWheel(userId: string, iterations?: number): Promise<{
        iterations: number;
        results: {
            lose: number;
            small: number;
            medium: number;
            big: number;
            jackpot: number;
        };
        totalStaked: number;
        totalPayout: number;
        houseEdge: number;
        rtp: number;
    }>;
    /**
     * Test Dice Roll game
     */
    static testDiceRoll(userId: string, betType: 'exact' | 'even_odd' | 'high_low', iterations?: number): Promise<{
        betType: "exact" | "even_odd" | "high_low";
        iterations: number;
        wins: number;
        winRate: number;
        totalStaked: number;
        totalPayout: number;
        rtp: number;
    }>;
}
//# sourceMappingURL=game-tester.d.ts.map