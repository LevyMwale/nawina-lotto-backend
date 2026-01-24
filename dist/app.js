"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const knex_1 = __importDefault(require("knex"));
const objection_1 = require("objection");
// Import routes
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const wallet_routes_1 = __importDefault(require("./routes/wallet.routes"));
const games_routes_1 = __importDefault(require("./routes/games.routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// ✅ CORS Configuration - Allow production and development origins
app.use((0, cors_1.default)({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'capacitor://localhost',
        'http://localhost',
        'ionic://localhost',
        /\.onrender\.com$/, // Allow all Render.com domains
        /\.vercel\.app$/, // If you deploy frontend to Vercel
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express_1.default.json());
// ✅ Database setup with SSL for production
const knexInstance = (0, knex_1.default)({
    client: 'pg',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'postgres',
        ssl: process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : false
    },
    pool: {
        min: 2,
        max: 10
    }
});
objection_1.Model.knex(knexInstance);
// Health check endpoints
app.get('/', (req, res) => {
    res.json({
        message: 'NaWiNa Lotto API',
        status: 'running',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'NaWiNa Lotto API is running' });
});
// Register routes
console.log('🔧 Registering routes...');
app.use('/api/auth', auth_routes_1.default);
console.log('✅ Auth routes registered at /api/auth');
app.use('/api/wallet', wallet_routes_1.default);
console.log('✅ Wallet routes registered at /api/wallet');
app.use('/api/games', games_routes_1.default);
console.log('✅ Games routes registered at /api/games');
// Debug: Log all registered routes
try {
    const routes = [];
    app._router?.stack?.forEach((middleware) => {
        if (middleware.route) {
            const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
            routes.push(`${methods} ${middleware.route.path}`);
        }
        else if (middleware.name === 'router') {
            middleware.handle?.stack?.forEach((handler) => {
                if (handler.route) {
                    const path = handler.route.path;
                    const methods = Object.keys(handler.route.methods).join(', ').toUpperCase();
                    const basePath = middleware.regexp.toString().match(/^\/\^\\\/([^\\]+)/)?.[1] || '';
                    routes.push(`${methods} /${basePath}${path}`);
                }
            });
        }
    });
    if (routes.length > 0) {
        console.log('📍 Registered routes:');
        routes.forEach(route => console.log(`   ${route}`));
    }
}
catch (err) {
    console.log('⚠️  Could not enumerate routes (this is fine)');
}
// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({
        error: 'Route not found',
        path: req.path,
        method: req.method,
        availableRoutes: [
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET /api/wallet/balance/:userId?',
            'POST /api/wallet/deposit',
            'POST /api/wallet/withdraw',
            'GET /api/wallet/transactions',
            'POST /api/games/spin/play',
            'POST /api/games/dice/play',
            'POST /api/games/lotto/play',
            'POST /api/games/aviator/play'
        ]
    });
});
// Error handler
app.use((err, req, res, next) => {
    console.error('💥 Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
    });
});
exports.default = app;
//# sourceMappingURL=app.js.map