import { Request, Response, NextFunction } from 'express';
import { MarketerService } from '../services/marketer.service';

export interface MarketerAuthRequest extends Request {
  marketerId?: string;
}

const marketerService = new MarketerService();

export async function authenticateMarketer(
  req: MarketerAuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = marketerService.verifyToken(token);
    req.marketerId = decoded.marketerId;
    next();
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Unauthorized' });
  }
}
