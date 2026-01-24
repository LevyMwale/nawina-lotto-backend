import crypto from 'crypto';
import seedrandom from 'seedrandom';

export class RNGService {
  /**
   * Generate a provably fair random number
   * Returns both the seed (for verification) and the random value
   */
  generateRandom(): { seed: string; random: number } {
    // Generate cryptographically secure seed
    const seed = crypto.randomBytes(32).toString('hex');

    // Create deterministic RNG from seed
    const rng = seedrandom(seed);
    const random = rng();

    return { seed, random };
  }

  /**
   * Verify a past result using its seed
   * Users can use this to verify games were fair
   */
  verifyRandom(seed: string): number {
    const rng = seedrandom(seed);
    return rng();
  }

  /**
   * Generate random integer in range [min, max]
   */
  generateRandomInt(min: number, max: number): { seed: string; value: number } {
    const { seed, random } = this.generateRandom();
    const value = Math.floor(random * (max - min + 1)) + min;
    return { seed, value };
  }
}