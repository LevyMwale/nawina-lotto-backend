export declare class RNGService {
    /**
     * Generate a provably fair random number
     * Returns both the seed (for verification) and the random value
     */
    generateRandom(): {
        seed: string;
        random: number;
    };
    /**
     * Verify a past result using its seed
     * Users can use this to verify games were fair
     */
    verifyRandom(seed: string): number;
    /**
     * Generate random integer in range [min, max]
     */
    generateRandomInt(min: number, max: number): {
        seed: string;
        value: number;
    };
}
//# sourceMappingURL=rng.service.d.ts.map