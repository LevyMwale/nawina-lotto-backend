import { Router } from 'express';
import { WalletService } from '../services/wallet.service';
import { Transaction } from '../models/Transaction';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const walletService = new WalletService();

console.log('📦 Wallet routes file loaded');

// ── Public health check (NO AUTH) ──
// GET /api/wallet/lipila-health
router.get('/lipila-health', async (_req, res) => {
  try {
    const apiKey = (process.env.LIPILA_API_KEY || '').trim();
    const baseUrl = (process.env.LIPILA_BASE_URL || 'https://blz.lipila.io').replace(/\/$/, '');

    if (!apiKey) {
      return res.status(503).json({
        status: 'missing_key',
        message: 'LIPILA_API_KEY is not set in environment variables',
        fix: 'Add LIPILA_API_KEY to Render dashboard env vars',
      });
    }

    const testUrl = `${baseUrl}/api/v1/collections/mobile-money/health-check-test-ref`;
    console.log(`[LipilaHealth] Testing auth with GET ${testUrl}`);

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    });

    const data: any = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return res.status(503).json({
        status: 'unauthorized',
        message: 'Lipila rejected the API key (HTTP 401)',
        keyPrefix: apiKey.slice(0, 4) + '...',
        keyLength: apiKey.length,
        baseUrl,
        lipilaError: data?.message || data?.error || null,
        fix: '1) Log into dashboard.lipila.io → Developer/API Keys → copy a fresh Secret Key. 2) Update LIPILA_API_KEY in Render env vars.',
      });
    }

    // 404 is expected (dummy reference doesn't exist) — it proves auth passed
    return res.json({
      status: 'ok',
      message: 'Lipila API key is valid',
      httpStatus: response.status,
      keyPrefix: apiKey.slice(0, 4) + '...',
      baseUrl,
      lipilaResponse: data?.message || null,
    });
  } catch (error: any) {
    console.error('[LipilaHealth] Exception:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Health check failed',
    });
  }
});

// ── Lipila webhook callback (NO AUTH) ──
// Lipila calls this when a mobile-money collection changes state.
// We look up the pending transaction by reference or identifier and complete it.
// POST /api/wallet/lipila-callback
router.post('/lipila-callback', async (req, res) => {
  try {
    const { referenceId, identifier, status: lipilaRawStatus, amount } = req.body || {};
    const ref = referenceId || identifier || '';
    console.log(`[LipilaCallback] Received — ref=${ref}, status=${lipilaRawStatus}, amount=${amount}`);

    if (!ref) {
      return res.status(400).json({ error: 'Missing referenceId or identifier' });
    }

    // Find the pending transaction by our reference OR Lipila's identifier
    let txn = await Transaction.query().findOne({ reference: ref });
    if (!txn) {
      txn = await Transaction.query().findOne({ 'metadata:lipila_identifier': ref });
    }

    if (!txn) {
      console.warn(`[LipilaCallback] No pending transaction found for ref=${ref}`);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (txn.status === 'completed') {
      console.log(`[LipilaCallback] Transaction already completed — txnId=${txn.id}`);
      return res.json({ status: 'ok', message: 'Already completed' });
    }

    const rawStatus = String(lipilaRawStatus || 'pending').toLowerCase();
    const isSuccess = ['success', 'completed', 'successful', 'done', 'paid'].includes(rawStatus);

    if (isSuccess) {
      const result = await walletService.completeDepositTransaction(txn, txn.wallet_id);
      console.log(`[LipilaCallback] Auto-completed — txnId=${txn.id}, newBalance=${result.newBalance}`);
      return res.json({ status: 'ok', message: 'Deposit completed', balance: result.newBalance });
    }

    const isFailure = ['failed', 'failure', 'error', 'rejected', 'cancelled'].includes(rawStatus);
    if (isFailure) {
      await Transaction.query().patch({ status: 'failed' }).where({ id: txn.id });
      console.log(`[LipilaCallback] Marked failed — txnId=${txn.id}`);
      return res.json({ status: 'ok', message: 'Marked as failed' });
    }

    console.log(`[LipilaCallback] Still pending — txnId=${txn.id}, rawStatus=${rawStatus}`);
    return res.json({ status: 'ok', message: 'Still pending' });
  } catch (error: any) {
    console.error('[LipilaCallback] Exception:', error);
    return res.status(500).json({ error: error.message || 'Webhook processing failed' });
  }
});

// Apply authentication to all routes BELOW this line
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

    console.log('✅ Deposit result:', result);

    res.json({
      success: true,
      balance: result.balance,
      transactionId: result.transactionId,
      pending: (result as any).pending || false,
      reference: (result as any).reference || null,
      message: (result as any).pending
        ? ((result as any).message || 'Deposit pending — please check your phone to approve')
        : `Deposit of K${amount} successful!`,
      invoice: (result as any).invoice
        ? {
            id: (result as any).invoice.id,
            invoiceNumber: (result as any).invoice.invoice_number,
            amount: (result as any).invoice.amount,
            exciseDuty: (result as any).invoice.excise_duty,
            netAmount: (result as any).invoice.net_amount,
            pdfUrl: `/api/invoices/${(result as any).invoice.id}/pdf`,
          }
        : null,
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

    console.log('✅ Withdrawal result:', result);

    res.json({
      success: true,
      balance: result.balance,
      transactionId: result.transactionId,
      pending: (result as any).pending || false,
      reference: (result as any).reference || null,
      message: (result as any).pending
        ? ((result as any).message || 'Withdrawal pending — processing via mobile money')
        : `Withdrawal of K${amount} successful!`,
    });
  } catch (error: any) {
    console.error('❌ Withdrawal error:', error);
    res.status(400).json({ error: error.message || 'Withdrawal failed' });
  }
});

// GET /api/wallet/deposit-status/:reference
router.get('/deposit-status/:reference', async (req: AuthRequest, res) => {
  try {
    const reference = Array.isArray(req.params.reference) ? req.params.reference[0] : req.params.reference;
    if (!reference) {
      return res.status(400).json({ error: 'Reference is required' });
    }
    const result = await walletService.getDepositStatus(reference, req.userId!);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Deposit status error:', error);
    res.status(400).json({ error: error.message || 'Failed to check deposit status' });
  }
});

// POST /api/wallet/force-complete-deposit/:reference
// Allows the user (or admin) to manually mark a pending deposit as completed
// when Lipila polling/webhooks are unreliable.
router.post('/force-complete-deposit/:reference', async (req: AuthRequest, res) => {
  try {
    const reference = Array.isArray(req.params.reference) ? req.params.reference[0] : req.params.reference;
    if (!reference) {
      return res.status(400).json({ error: 'Reference is required' });
    }
    const result = await walletService.forceCompleteDeposit(reference, req.userId!);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Force complete deposit error:', error);
    res.status(400).json({ error: error.message || 'Failed to complete deposit' });
  }
});

console.log('✅ Wallet routes configured with endpoints:');
console.log('   - GET  /balance');
console.log('   - GET  /balance/:userId');
console.log('   - GET  /transactions');
console.log('   - POST /deposit');
console.log('   - POST /withdraw');
console.log('   - GET  /deposit-status/:reference');
console.log('   - POST /force-complete-deposit/:reference');
console.log('   - POST /lipila-callback');
console.log('   - GET  /lipila-health');

export default router;