import { Router } from 'express';
import { AdminService } from '../services/admin.service';
import { WalletService } from '../services/wallet.service';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { GamePlay } from '../models/GamePlay';
import { authenticateAdmin, AdminAuthRequest, requireRole } from '../middleware/admin.middleware';

const router = Router();
const adminService = new AdminService();
const walletService = new WalletService();

console.log('📦 Admin routes file loaded');

const str = (v: any): string => (Array.isArray(v) ? v[0] : v) as string;

// ============================================
// AUTH
// ============================================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const result = await adminService.login(username, password);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

// All routes below require admin authentication
router.use(authenticateAdmin);

// ============================================
// ADMIN USER MANAGEMENT
// ============================================
router.get('/admins', requireRole('super_admin'), async (req, res) => {
  try {
    const admins = await adminService.listAdmins();
    res.json({ admins });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/admins', requireRole('super_admin'), async (req: AdminAuthRequest, res) => {
  try {
    const { username, password, role, full_name } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const admin = await adminService.createAdmin(username, password, role, full_name);
    res.status(201).json({ admin });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', async (req, res) => {
  try {
    const sum = async (where: Record<string, any>): Promise<number> => {
      const r: any = await Transaction.query().where(where).sum('amount as total').first();
      return Number(r?.total) || 0;
    };

    const count = async (table: 'users' | 'transactions' | 'game_plays', where?: Record<string, any>): Promise<number> => {
      let q: any;
      if (table === 'users') q = User.query();
      else if (table === 'transactions') q = Transaction.query();
      else q = GamePlay.query();
      if (where) q = q.where(where);
      return q.resultSize();
    };

    const [
      totalUsers,
      activeUsers,
      totalDeposits,
      totalWithdrawals,
      totalBets,
      pendingWithdrawals,
    ] = await Promise.all([
      count('users'),
      count('users', { status: 'active' }),
      sum({ type: 'deposit', status: 'completed' }),
      Promise.resolve().then(async () => Math.abs(await sum({ type: 'withdrawal', status: 'completed' }))),
      count('transactions', { type: 'bet' }),
      count('transactions', { type: 'withdrawal', status: 'pending' }),
    ]);

    const totalPayouts = await sum({ type: 'win' });
    const totalBetAmount = Math.abs(await sum({ type: 'bet' }));

    const houseEdge =
      totalBetAmount > 0
        ? Number((((totalBetAmount - totalPayouts) / totalBetAmount) * 100).toFixed(2))
        : 0;

    res.json({
      totalUsers,
      activeUsers,
      totalDeposits,
      totalWithdrawals,
      pendingWithdrawals,
      totalBets,
      houseEdge,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// USER MANAGEMENT
// ============================================
router.get('/users', async (req, res) => {
  try {
    const limit = parseInt(str(req.query.limit)) || 50;
    const offset = parseInt(str(req.query.offset)) || 0;
    const status = req.query.status ? str(req.query.status) : undefined;
    const search = req.query.search ? str(req.query.search) : undefined;

    let query = User.query()
      .withGraphJoined('wallet')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (status && status !== 'all') {
      query = query.where({ status });
    }

    if (search) {
      query = query.where((builder: any) => {
        builder
          .where('phone', 'ilike', `%${search}%`)
          .orWhere('full_name', 'ilike', `%${search}%`);
      });
    }

    const users = await query;

    res.json({
      total: users.length,
      users: users.map((u: any) => ({
        id: u.id,
        phone: u.phone,
        full_name: u.full_name,
        status: u.status,
        kyc_status: u.kyc_status,
        created_at: u.created_at,
        balance: u.wallet ? Number(u.wallet.balance) : 0,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const userId = str(req.params.userId);

    const user: any = await User.query()
      .findById(userId)
      .withGraphJoined('wallet');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const walletSubq = Wallet.query().select('id').where({ user_id: userId });

    const sum = async (where: Record<string, any>): Promise<number> => {
      const r: any = await Transaction.query()
        .whereIn('wallet_id', walletSubq)
        .where(where)
        .sum('amount as total')
        .first();
      return Number(r?.total) || 0;
    };

    const [totalDeposits, totalWithdrawals, totalBets, totalWins, playCount] =
      await Promise.all([
        sum({ type: 'deposit', status: 'completed' }),
        Promise.resolve().then(async () => Math.abs(await sum({ type: 'withdrawal', status: 'completed' }))),
        Promise.resolve().then(async () => {
          const r: any = await GamePlay.query()
            .where({ user_id: userId })
            .sum('stake as total')
            .first();
          return Number(r?.total) || 0;
        }),
        Promise.resolve().then(async () => {
          const r: any = await GamePlay.query()
            .where({ user_id: userId })
            .sum('payout as total')
            .first();
          return Number(r?.total) || 0;
        }),
        GamePlay.query().where({ user_id: userId }).resultSize(),
      ]);

    res.json({
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
        status: user.status,
        kyc_status: user.kyc_status,
        created_at: user.created_at,
        balance: user.wallet ? Number(user.wallet.balance) : 0,
        stats: {
          total_deposits: totalDeposits,
          total_withdrawals: totalWithdrawals,
          total_bets: totalBets,
          total_wins: totalWins,
          games_played: playCount,
        },
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/users/:userId/status', async (req: AdminAuthRequest, res) => {
  try {
    const userId = str(req.params.userId);
    const { status } = req.body;
    if (!['active', 'suspended', 'banned'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.query().findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await User.query()
      .patch({
        status,
        is_active: status === 'active',
        updated_at: new Date(),
      })
      .where({ id: userId });

    res.json({ user_id: userId, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// TRANSACTION MANAGEMENT
// ============================================
router.get('/transactions', async (req, res) => {
  try {
    const limit = parseInt(str(req.query.limit)) || 50;
    const offset = parseInt(str(req.query.offset)) || 0;
    const type = req.query.type ? str(req.query.type) : undefined;
    const status = req.query.status ? str(req.query.status) : undefined;

    let query = Transaction.query()
      .withGraphJoined('wallet')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (type && type !== 'all') {
      query = query.where({ type });
    }
    if (status && status !== 'all') {
      query = query.where({ status });
    }

    const transactions = await query;

    res.json({
      total: transactions.length,
      transactions: transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        status: t.status,
        reference: t.reference,
        balance_before: Number(t.balance_before),
        balance_after: Number(t.balance_after),
        metadata: t.metadata,
        created_at: t.created_at,
        user: t.wallet
          ? { user_id: t.wallet.user_id }
          : null,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/transactions/:transactionId/approve', async (req: AdminAuthRequest, res) => {
  try {
    const result = await walletService.approveWithdrawal(
      str(req.params.transactionId),
      req.adminId!
    );
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/transactions/:transactionId/reject', async (req: AdminAuthRequest, res) => {
  try {
    const { reason } = req.body;
    const result = await walletService.rejectWithdrawal(
      str(req.params.transactionId),
      req.adminId!,
      reason
    );
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// BONUSES
// ============================================
router.post('/users/:userId/bonus', async (req: AdminAuthRequest, res) => {
  try {
    const userId = str(req.params.userId);
    const { amount, reason } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid bonus amount is required' });
    }

    const result = await walletService.addBonus(
      userId,
      Number(amount),
      reason || 'Admin issued bonus',
      req.adminId!
    );

    res.json({
      success: true,
      transaction_id: result.transaction_id,
      new_balance: result.new_balance,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// GAME SESSIONS (admin view)
// ============================================
router.get('/games', async (req, res) => {
  try {
    const limit = parseInt(str(req.query.limit)) || 50;
    const offset = parseInt(str(req.query.offset)) || 0;
    const gameType = req.query.game_type ? str(req.query.game_type) : undefined;

    let query = GamePlay.query()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (gameType && gameType !== 'all') {
      query = query.where({ game_type: gameType });
    }

    const plays = await query;

    const userIds = [...new Set(plays.map((p) => p.user_id))];
    const users = await User.query()
      .select('id', 'phone', 'full_name')
      .whereIn('id', userIds);
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    res.json({
      total: plays.length,
      games: plays.map((p) => {
        const u: any = userMap.get(p.user_id);
        return {
          id: p.id,
          game_type: p.game_type,
          stake: Number(p.stake),
          payout: Number(p.payout),
          result: p.result,
          created_at: p.created_at,
          user: u
            ? { id: u.id, phone: u.phone, full_name: u.full_name }
            : null,
        };
      }),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

console.log('✅ Admin routes configured');

export default router;
