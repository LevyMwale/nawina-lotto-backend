type LottoVariant = 'pick3' | 'pick5';
interface LottoBet {
    variant: LottoVariant;
    numbers: number[];
}
export declare class LottoService {
    private walletService;
    private rngService;
    constructor();
    /**
     * Play Pick Numbers Lotto
     */
    play(userId: string, bet: LottoBet): Promise<{
        success: boolean;
        game_id: string;
        variant: LottoVariant;
        user_numbers: number[];
        winning_numbers: number[];
        matches: number;
        stake: number;
        payout: number;
        balance: number;
        seed: string;
    }>;
    /**
     * Validate user's number selection
     */
    private validateNumbers;
    /**
     * Draw random winning numbers
     */
    private drawNumbers;
    /**
     * Count matching numbers
     */
    private countMatches;
}
export {};
//# sourceMappingURL=lotto.service.d.ts.map