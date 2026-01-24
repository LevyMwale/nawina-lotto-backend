"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = require("../models/User");
const Wallet_1 = require("../models/Wallet");
const objection_1 = require("objection");
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';
class AuthService {
    // Register new user
    async register(phone, pin, fullName) {
        // Validate phone format (Zambian: +260...)
        if (!phone.match(/^\+260[0-9]{9}$/)) {
            throw new Error('Invalid Zambian phone number. Use format: +260XXXXXXXXX');
        }
        // Validate PIN (4-6 digits)
        if (!pin.match(/^[0-9]{4,6}$/)) {
            throw new Error('PIN must be 4-6 digits');
        }
        // Check if user exists
        const existingUser = await User_1.User.query().findOne({ phone });
        if (existingUser) {
            throw new Error('Phone number already registered');
        }
        // Hash PIN
        const pinHash = await bcryptjs_1.default.hash(pin, 12);
        // Create user and wallet atomically
        const user = await (0, objection_1.transaction)(User_1.User.knex(), async (trx) => {
            // Create user
            const newUser = await User_1.User.query(trx).insert({
                phone,
                pin_hash: pinHash,
                full_name: fullName,
                kyc_status: 'pending',
                is_active: true,
            });
            // Create wallet
            await Wallet_1.Wallet.query(trx).insert({
                user_id: newUser.id,
                balance: 0,
                currency: 'ZMW',
            });
            return newUser;
        });
        // Generate token
        const token = this.generateToken(user.id);
        return {
            user: {
                id: user.id,
                phone: user.phone,
                full_name: user.full_name,
                kyc_status: user.kyc_status,
            },
            token,
        };
    }
    // Login
    async login(phone, pin) {
        // Find user
        const user = await User_1.User.query().findOne({ phone });
        if (!user) {
            throw new Error('Invalid phone number or PIN');
        }
        // Check if active
        if (!user.is_active) {
            throw new Error('Account is deactivated. Contact support.');
        }
        // Verify PIN
        const isValid = await bcryptjs_1.default.compare(pin, user.pin_hash);
        if (!isValid) {
            throw new Error('Invalid phone number or PIN');
        }
        // Get wallet balance
        const wallet = await Wallet_1.Wallet.query().findOne({ user_id: user.id });
        // Generate token
        const token = this.generateToken(user.id);
        return {
            user: {
                id: user.id,
                phone: user.phone,
                full_name: user.full_name,
                kyc_status: user.kyc_status,
                balance: wallet?.balance || 0,
            },
            token,
        };
    }
    // Generate JWT token
    generateToken(userId) {
        return jsonwebtoken_1.default.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    }
    // Verify token
    verifyToken(token) {
        try {
            return jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (error) {
            throw new Error('Invalid or expired token');
        }
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=auth.service.js.map