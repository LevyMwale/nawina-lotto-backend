"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RNGService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const seedrandom_1 = __importDefault(require("seedrandom"));
class RNGService {
    /**
     * Generate a provably fair random number
     * Returns both the seed (for verification) and the random value
     */
    generateRandom() {
        // Generate cryptographically secure seed
        const seed = crypto_1.default.randomBytes(32).toString('hex');
        // Create deterministic RNG from seed
        const rng = (0, seedrandom_1.default)(seed);
        const random = rng();
        return { seed, random };
    }
    /**
     * Verify a past result using its seed
     * Users can use this to verify games were fair
     */
    verifyRandom(seed) {
        const rng = (0, seedrandom_1.default)(seed);
        return rng();
    }
    /**
     * Generate random integer in range [min, max]
     */
    generateRandomInt(min, max) {
        const { seed, random } = this.generateRandom();
        const value = Math.floor(random * (max - min + 1)) + min;
        return { seed, value };
    }
}
exports.RNGService = RNGService;
//# sourceMappingURL=rng.service.js.map