import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    userId?: string;
}
export declare const authenticate: (req: AuthRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=auth.middleware.d.ts.map