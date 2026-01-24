"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const auth_service_1 = require("../services/auth.service");
const authService = new auth_service_1.AuthService();
const authenticate = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.substring(7);
        const { userId } = authService.verifyToken(token);
        req.userId = userId;
        next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
exports.authenticate = authenticate;
//# sourceMappingURL=auth.middleware.js.map