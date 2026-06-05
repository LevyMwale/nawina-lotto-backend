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
    // eslint-disable-next-line no-console
    console.error('💥 /auth/register FULL error:', JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
    // eslint-disable-next-line no-console
    console.error('💥 /auth/register summary:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    res.status(400).json({
      error: error?.message || 'Could not create account',
      _dbg: {
        name: error?.name,
        code: error?.code,
        detail: error?.detail,
        constraint: error?.constraint,
        raw: typeof error === 'object' ? JSON.stringify(error) : String(error),
      },
    });
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
    // Temporary diagnostic — log the full error to the Render log so we
    // can see what `error.message` actually contains when login fails
    // with an empty string in the response. Remove once the root cause
    // is identified.
    // eslint-disable-next-line no-console
    console.error('💥 /auth/login error:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
    });
    res.status(401).json({ error: error?.message || 'Invalid phone number or PIN' });
  }
});

export default router;