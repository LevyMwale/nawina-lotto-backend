import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { transaction } from 'objection';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '40m';

export class AuthService {
  // Normalize Zambian phone to +260XXXXXXXXX
  private normalizePhone(phone: string): string {
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('0')) return '+260' + p.slice(1);
    if (p.startsWith('260')) return '+' + p;
    if (!p.startsWith('+260')) return '+260' + p;
    return p;
  }

  // Register new user
  async register(phone: string, pin: string, fullName?: string) {
    // Normalize phone
    phone = this.normalizePhone(phone);

    // Validate phone format (Zambian: +260...)
    if (!phone.match(/^\+260[0-9]{9}$/)) {
      throw new Error('Invalid Zambian phone number. Use format: +260XXXXXXXXX');
    }

    // Validate PIN (4-6 digits)
    if (!pin.match(/^[0-9]{4,6}$/)) {
      throw new Error('PIN must be 4-6 digits');
    }

    // Check if user exists
    const existingUser = await User.query().findOne({ phone });
    if (existingUser) {
      throw new Error('Phone number already registered');
    }

    // Hash PIN
    const pinHash = await bcrypt.hash(pin, 12);

    // Create user and wallet atomically
    const user = await transaction(User.knex(), async (trx) => {
      const newUser = await User.query(trx).insert({
        phone,
        pin_hash: pinHash,
        full_name: fullName,
        kyc_status: 'pending',
        is_active: true,
      });

      await Wallet.query(trx).insert({
        user_id: newUser.id,
        balance: 0,
        currency: 'ZMW',
      });

      return newUser;
    });

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
  async login(phone: string, pin: string) {
    // Normalize phone
    phone = this.normalizePhone(phone);

    // Find user
    const user = await User.query().findOne({ phone });
    if (!user) {
      throw new Error('Invalid phone number or PIN');
    }

    // Check if active
    if (!user.is_active) {
      throw new Error('Account is deactivated. Contact support.');
    }

    // Verify PIN
    const isValid = await bcrypt.compare(pin, user.pin_hash);
    if (!isValid) {
      throw new Error('Invalid phone number or PIN');
    }

    // Get wallet balance
    const wallet = await Wallet.query().findOne({ user_id: user.id });

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
  private generateToken(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  // Verify token
  verifyToken(token: string): { userId: string } {
    try {
      return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }
}