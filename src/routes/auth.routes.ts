import { Router } from 'express';
import { AuthService } from '../services/auth.service';

const router = Router();
const authService = new AuthService();

router.post('/register', async (req, res) => {
  try {
    const { phone, pin, fullName } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }

    const result = await authService.register(phone, pin, fullName);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN are required' });
    }

    const result = await authService.login(phone, pin);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

export default router;