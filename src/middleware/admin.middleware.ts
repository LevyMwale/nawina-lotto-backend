import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export interface AdminAuthRequest extends Request {
  adminId?: string;
  adminRole?: string;
}

export const authenticateAdmin = (
  req: AdminAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    // Pin algorithm to HS256 — see auth.service.ts for the rationale.
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as {
      adminId?: string;
      userId?: string;
      role?: string;
    };

    // Admin tokens have adminId, regular user tokens have userId
    if (!decoded.adminId) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.adminId = decoded.adminId;
    req.adminRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    if (!req.adminRole || !roles.includes(req.adminRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};
