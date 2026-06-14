import { Router } from 'express';
import { MarketerService } from '../services/marketer.service';
import { authenticateMarketer, MarketerAuthRequest } from '../middleware/marketer.middleware';

const router = Router();
const marketerService = new MarketerService();

router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }
    const result = await marketerService.login(phone, pin);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

router.use(authenticateMarketer);

router.get('/me', async (req: MarketerAuthRequest, res) => {
  try {
    const marketer = await marketerService.getMarketer(req.marketerId!);
    res.json({ marketer });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/stats', async (req: MarketerAuthRequest, res) => {
  try {
    const stats = await marketerService.getDashboardStats(req.marketerId!);
    res.json(stats);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/referrals', async (req: MarketerAuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await marketerService.getReferrals(req.marketerId!, limit, offset);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
