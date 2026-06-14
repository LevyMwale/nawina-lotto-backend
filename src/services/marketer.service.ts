import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { transaction } from 'objection';
import { Marketer } from '../models/Marketer';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const MARKETER_JWT_EXPIRES_IN = '7d';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/I/1 confusion

export class MarketerService {
  private normalizePhone(phone: string): string {
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('0')) return '+260' + p.slice(1);
    if (p.startsWith('260')) return '+' + p;
    if (!p.startsWith('+260')) return '+260' + p;
    return p;
  }

  private async generateUniqueCode(): Promise<string> {
    while (true) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET.charAt(
          Math.floor(Math.random() * CODE_ALPHABET.length)
        );
      }

      const existing = await Marketer.query().findOne({ code });
      if (!existing) {
        return code;
      }
    }
  }

  async createMarketer(
    phone: string,
    pin: string,
    fullName: string,
    createdByAdminId: string,
    commissionRate = 0
  ) {
    phone = this.normalizePhone(phone);

    if (!phone.match(/^\+260[0-9]{9}$/)) {
      throw new Error('Invalid Zambian phone number. Use format: +260XXXXXXXXX');
    }

    if (!pin.match(/^[0-9]{4,6}$/)) {
      throw new Error('PIN must be 4-6 digits');
    }

    const existing = await Marketer.query().findOne({ phone });
    if (existing) {
      throw new Error('Phone number already registered as a marketer');
    }

    const pinHash = await bcrypt.hash(pin, 12);
    const code = await this.generateUniqueCode();

    const marketer = await transaction(Marketer.knex(), async (trx) => {
      return await Marketer.query(trx).insert({
        phone,
        pin_hash: pinHash,
        full_name: fullName,
        code,
        status: 'active',
        commission_rate: commissionRate,
        created_by_admin: createdByAdminId,
      });
    });

    return {
      id: marketer.id,
      phone: marketer.phone,
      full_name: marketer.full_name,
      code: marketer.code,
      status: marketer.status,
      commission_rate: marketer.commission_rate,
      created_at: marketer.created_at,
    };
  }

  async login(phone: string, pin: string) {
    phone = this.normalizePhone(phone);

    const marketer = await Marketer.query().findOne({ phone });
    if (!marketer) {
      throw new Error('Invalid phone number or PIN');
    }

    if (marketer.status !== 'active') {
      throw new Error('Marketer account is suspended. Contact support.');
    }

    const isValid = await bcrypt.compare(pin, marketer.pin_hash);
    if (!isValid) {
      throw new Error('Invalid phone number or PIN');
    }

    const token = jwt.sign({ marketerId: marketer.id }, JWT_SECRET, {
      expiresIn: MARKETER_JWT_EXPIRES_IN,
      algorithm: 'HS256',
    });

    return {
      marketer: {
        id: marketer.id,
        phone: marketer.phone,
        full_name: marketer.full_name,
        code: marketer.code,
        status: marketer.status,
        commission_rate: marketer.commission_rate,
        total_signups: marketer.total_signups,
        total_deposits: Number(marketer.total_deposits),
      },
      token,
    };
  }

  verifyToken(token: string): { marketerId: string } {
    try {
      return jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as { marketerId: string };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  async getMarketer(marketerId: string) {
    const marketer = await Marketer.query().findById(marketerId);
    if (!marketer) {
      throw new Error('Marketer not found');
    }

    return {
      id: marketer.id,
      phone: marketer.phone,
      full_name: marketer.full_name,
      code: marketer.code,
      status: marketer.status,
      commission_rate: marketer.commission_rate,
      total_signups: marketer.total_signups,
      total_deposits: Number(marketer.total_deposits),
      total_wagering: Number(marketer.total_wagering),
      created_at: marketer.created_at,
    };
  }

  async listMarketers(options?: { status?: string; search?: string; limit?: number; offset?: number }) {
    const { status, search, limit = 50, offset = 0 } = options || {};

    let query = Marketer.query();

    if (status) {
      query = query.where({ status });
    }

    if (search) {
      const term = `%${search}%`;
      query = query.where((builder) => {
        builder
          .where('phone', 'ilike', term)
          .orWhere('full_name', 'ilike', term)
          .orWhere('code', 'ilike', term);
      });
    }

    const [marketers, total] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(limit).offset(offset),
      query.resultSize(),
    ]);

    return {
      total,
      limit,
      offset,
      marketers: marketers.map((m) => ({
        id: m.id,
        phone: m.phone,
        full_name: m.full_name,
        code: m.code,
        status: m.status,
        commission_rate: m.commission_rate,
        total_signups: m.total_signups,
        total_deposits: Number(m.total_deposits),
        total_wagering: Number(m.total_wagering),
        created_at: m.created_at,
      })),
    };
  }

  async updateStatus(marketerId: string, status: 'active' | 'suspended') {
    const marketer = await Marketer.query().findById(marketerId);
    if (!marketer) {
      throw new Error('Marketer not found');
    }

    await Marketer.query()
      .patch({ status, updated_at: new Date() })
      .where({ id: marketerId });

    return { id: marketerId, status };
  }

  async getReferrals(marketerId: string, limit = 100, offset = 0) {
    const marketer = await Marketer.query().findById(marketerId);
    if (!marketer) {
      throw new Error('Marketer not found');
    }

    const [users, total] = await Promise.all([
      User.query()
        .where({ referred_by_marketer_id: marketerId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .withGraphFetched('wallet'),
      User.query()
        .where({ referred_by_marketer_id: marketerId })
        .resultSize(),
    ]);

    return {
      total,
      limit,
      offset,
      users: users.map((u: any) => ({
        id: u.id,
        phone: u.phone,
        full_name: u.full_name,
        created_at: u.created_at,
        balance: Number(u.wallet?.balance ?? 0),
        first_deposit_at: u.first_deposit_at,
        first_deposit_amount: u.first_deposit_amount,
      })),
    };
  }

  /**
   * Dashboard stats for a marketer.
   */
  async getDashboardStats(marketerId: string) {
    const marketer = await Marketer.query().findById(marketerId);
    if (!marketer) {
      throw new Error('Marketer not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySignups = await User.query()
      .where({ referred_by_marketer_id: marketerId })
      .where('created_at', '>=', today.toISOString())
      .resultSize();

    return {
      code: marketer.code,
      referral_link: `https://nawina.app?ref=${marketer.code}`,
      total_signups: marketer.total_signups,
      today_signups: todaySignups,
      total_deposits: Number(marketer.total_deposits),
      total_wagering: Number(marketer.total_wagering),
      commission_rate: marketer.commission_rate,
    };
  }

  /**
   * Look up a marketer by their referral code.
   */
  async findByCode(code: string) {
    return await Marketer.query().findOne({ code: code.toUpperCase(), status: 'active' });
  }
}
