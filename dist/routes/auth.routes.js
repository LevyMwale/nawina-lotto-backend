"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_service_1 = require("../services/auth.service");
const router = (0, express_1.Router)();
const authService = new auth_service_1.AuthService();
router.post('/register', async (req, res) => {
    try {
        const { phone, pin, fullName } = req.body;
        if (!phone || !pin) {
            return res.status(400).json({ error: 'Phone and PIN are required' });
        }
        const result = await authService.register(phone, pin, fullName);
        res.status(201).json(result);
    }
    catch (error) {
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
    }
    catch (error) {
        res.status(401).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map