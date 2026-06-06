import { Router } from 'express';
import { AdminService } from '../services/admin.service';
import { TaxService } from '../services/tax.service';
import { PdfService } from '../services/pdf.service';
import { WalletService } from '../services/wallet.service';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { GamePlay } from '../models/GamePlay';
import { authenticateAdmin, AdminAuthRequest, requireRole } from '../middleware/admin.middleware';

const router = Router();
const adminService = new AdminService();
const taxService = new TaxService();
const pdfService = new PdfService();
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

// Self-service password change. Any signed-in admin can hit this —
// but the route always uses req.adminId from the verified JWT, so
// no one can change someone else's password even by tampering with
// the request body. No requireRole gate: super_admins, admins, and
// support all get to rotate their own.
router.post('/admins/me/change-password', async (req: AdminAuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    await adminService.changePassword(req.adminId!, currentPassword, newPassword);
    res.json({ success: true });
  } catch (error: any) {
    const msg = error?.message || 'Failed to change password';
    // 401 for auth-shaped failures (wrong current password, deactivated
    // account). 400 for everything else (validation: length, same-as-old).
    // The 404 "Admin not found" is unlikely (their own JWT points at a
    // deleted row) but we surface it as 401 too — same auth-flavoured
    // class of problem.
    const status = msg.includes('incorrect') || msg.includes('not found') || msg.includes('deactivated') ? 401 : 400;
    res.status(status).json({ error: msg });
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
      .withGraphJoined('wallet.user')
      // Qualify every column reference. Once we join wallet.user, the
      // `status` column exists in BOTH transactions and users, so an
      // unqualified `where("status", ...)` produces SQL with
      // "column reference \"status\" is ambiguous" and Postgres rejects
      // the query. The shorthand `where({ status })` is exactly that
      // unqualified form, so we drop it and use the column-qualified
      // `where(col, value)` overload instead.
      .orderBy('transactions.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (type && type !== 'all') {
      query = query.where('transactions.type', type);
    }
    if (status && status !== 'all') {
      query = query.where('transactions.status', status);
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
        user: t.wallet?.user
          ? {
              user_id: t.wallet.user.id,
              phone: t.wallet.user.phone,
              full_name: t.wallet.user.full_name,
            }
          : t.wallet
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

// ============================================
// ZRA TAX RETURNS + OPERATOR PROFILE
// ============================================
// All routes below are super_admin only. Tax work is sensitive
// (filed returns are financial records) and the operator profile
// is what gets printed on every PDF — only the most-trusted role
// should be able to change it.

// GET /api/admin/tax/returns — list all returns, newest first
router.get('/tax/returns', requireRole('super_admin'), async (_req, res) => {
  try {
    const rows = await taxService.listReturns();
    res.json({ returns: rows.map(serializeReturn) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/tax/returns — generate a draft for the given period
router.post('/tax/returns', requireRole('super_admin'), async (req, res) => {
  try {
    const { periodStart, periodEnd } = req.body || {};
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'periodStart and periodEnd are required (YYYY-MM-DD)' });
    }
    const ret = await taxService.generateReturn(periodStart, periodEnd);
    res.status(201).json({ return: serializeReturn(ret) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/admin/tax/returns/:id — fetch one
router.get('/tax/returns/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const ret = await taxService.getReturn(str(req.params.id));
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    res.json({ return: serializeReturn(ret) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/admin/tax/returns/:id/pdf — download the tax return PDF
router.get('/tax/returns/:id/pdf', requireRole('super_admin'), async (req, res) => {
  try {
    const ret = await taxService.getReturn(str(req.params.id));
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    const operator = await taxService.getOperatorProfile();
    const pdf = await pdfService.renderTaxReturnPdf({ ret, operator });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="ZRA-return-${ret.period_start}-to-${ret.period_end}.pdf"`,
    );
    res.send(pdf);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/tax/returns/:id/file — mark as filed (locks the snapshot)
router.post('/tax/returns/:id/file', requireRole('super_admin'), async (req: AdminAuthRequest, res) => {
  try {
    const ret = await taxService.markFiled(str(req.params.id), req.adminId!);
    res.json({ return: serializeReturn(ret) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/admin/tax/operator-profile — read the company info that goes on PDFs
router.get('/tax/operator-profile', requireRole('super_admin'), async (_req, res) => {
  try {
    const p = await taxService.getOperatorProfile();
    res.json({ profile: serializeProfile(p) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/admin/tax/operator-profile — update the company info
router.patch('/tax/operator-profile', requireRole('super_admin'), async (req, res) => {
  try {
    const allowed = ['company_name', 'tpin', 'address', 'phone'] as const;
    const patch: any = {};
    for (const k of allowed) {
      if (k in (req.body || {})) patch[k === 'company_name' ? 'company_name' : k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No recognised fields in body' });
    }
    const p = await taxService.updateOperatorProfile(patch);
    res.json({ profile: serializeProfile(p) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

function serializeReturn(r: any) {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    totalDeposits: Number(r.total_deposits),
    totalPayouts: Number(r.total_payouts),
    netRevenue: Number(r.net_revenue),
    presumptiveTax: Number(r.presumptive_tax),
    withholdingTax: Number(r.withholding_tax),
    exciseDuty: Number(r.excise_duty),
    totalTax: Number(r.total_tax),
    status: r.status,
    filedAt: r.filed_at,
    filedBy: r.filed_by,
    createdAt: r.created_at,
    // Only include the player breakdown on the single-return fetch —
    // list views omit it to keep the payload small.
    playerBreakdown: 'player_breakdown' in r ? r.player_breakdown : undefined,
  };
}

function serializeProfile(p: any) {
  return {
    companyName: p.company_name,
    tpin: p.tpin,
    address: p.address,
    phone: p.phone,
    updatedAt: p.updated_at,
  };
}

console.log('✅ Admin routes configured');

export default router;
