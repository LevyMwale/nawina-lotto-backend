import { Router } from 'express';
import { WalletService } from '../services/wallet.service';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const walletService = new WalletService();

console.log('📦 Wallet routes file loaded');

// Apply authentication to all routes
router.use(authenticate);

// GET /api/wallet/balance (use authenticated user's ID)
router.get('/balance', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    console.log('📊 Balance request - userId from auth:', req.userId);
    const balance = await walletService.getBalance(userId);
    res.json(balance);
  } catch (error: any) {
    console.error('❌ Balance error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/wallet/balance/:userId (use specific user ID from params)
router.get('/balance/:userId', async (req: AuthRequest, res) => {
  try {
    const userIdParam = req.params.userId;
    const userId = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;

    console.log('📊 Balance request - userId from params:', userId);
    const balance = await walletService.getBalance(userId);
    res.json(balance);
  } catch (error: any) {
    console.error('❌ Balance error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    console.log('📜 Transactions request - userId:', req.userId, 'limit:', limit, 'offset:', offset);
    const transactions = await walletService.getTransactions(req.userId!, limit, offset);
    res.json(transactions);
  } catch (error: any) {
    console.error('❌ Transactions error:', error);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/wallet/deposit
router.post('/deposit', async (req: AuthRequest, res) => {
  try {
    const { amount, method, mobileNumber, cardDetails } = req.body;
    const userId = req.userId!;

    console.log('💵 Deposit request:', { userId, amount, method });

    // Validate amount
    if (!amount || amount < 2) {
      return res.status(400).json({ error: 'Minimum deposit is K2' });
    }

    // Validate payment method details
    if (['airtel', 'mtn', 'zamtel'].includes(method) && !mobileNumber) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }

    if (method === 'visa' && (!cardDetails || !cardDetails.number || !cardDetails.expiry || !cardDetails.cvv)) {
      return res.status(400).json({ error: 'Card details are required' });
    }

    // Process deposit
    const result = await walletService.deposit(userId, amount, method, {
      mobileNumber,
      cardDetails
    });

    console.log('✅ Deposit successful:', result);

    res.json({
      success: true,
      balance: result.balance,
      transactionId: result.transactionId,
      message: `Deposit of K${amount} successful!`
    });
  } catch (error: any) {
    console.error('❌ Deposit error:', error);
    res.status(400).json({ error: error.message || 'Deposit failed' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', async (req: AuthRequest, res) => {
  try {
    const { amount, method, mobileNumber, cardDetails } = req.body;
    const userId = req.userId!;

    console.log('💸 Withdraw request:', { userId, amount, method });

    // Validate amount
    if (!amount || amount < 10) {
      return res.status(400).json({ error: 'Minimum withdrawal is K10' });
    }

    // Validate payment method details
    if (['airtel', 'mtn', 'zamtel'].includes(method) && !mobileNumber) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }

    if (method === 'visa' && (!cardDetails || !cardDetails.number || !cardDetails.expiry || !cardDetails.cvv)) {
      return res.status(400).json({ error: 'Card details are required' });
    }

    // Process withdrawal
    const result = await walletService.withdraw(userId, amount, method, {
      mobileNumber,
      cardDetails
    });

    console.log('✅ Withdrawal successful:', result);

    res.json({
      success: true,
      balance: result.balance,
      transactionId: result.transactionId,
      message: `Withdrawal of K${amount} successful!`
    });
  } catch (error: any) {
    console.error('❌ Withdrawal error:', error);
    res.status(400).json({ error: error.message || 'Withdrawal failed' });
  }
});

console.log('✅ Wallet routes configured with endpoints:');
console.log('   - GET  /balance');
console.log('   - GET  /balance/:userId');
console.log('   - GET  /transactions');
console.log('   - POST /deposit');
console.log('   - POST /withdraw');

export default router;