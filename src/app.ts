import express from 'express';
import dotenv from 'dotenv';
import knex from 'knex';
import { Model } from 'objection';

// Import routes
import authRoutes from './routes/auth.routes';
import walletRoutes from './routes/wallet.routes';
import invoiceRoutes from './routes/invoice.routes';
import gamesRoutes from './routes/games.routes';
import adminRoutes from './routes/admin.routes';
import soccerRoutes from './routes/soccer.routes';

dotenv.config();

const app = express();

/**
 * Custom CORS middleware — replaces the `cors` npm package because v2.8.5
 * doesn't support Private Network Access (PNA), and Chrome requires
 * `Access-Control-Allow-Private-Network: true` on preflight responses when
 * the request goes from a public-ish context (e.g. localhost in mobile
 * emulation) to a private network target. Without it, the preflight returns
 * 204 successfully but the browser silently drops the actual POST.
 */
const isDev = process.env.NODE_ENV !== 'production';

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // server-to-server, curl, Capacitor native
  if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const allowed: Array<string | RegExp> = [
    // Capacitor's WebViewLocalServer origins — when `androidScheme: 'https'`
    // is set in capacitor.config.ts, the WebView loads `https://localhost/`
    // (port 443 internally). These must be allowed in PRODUCTION, not just
    // dev, because the packaged APK ships with androidScheme='https'.
    /^https?:\/\/localhost(:\d+)?$/,
    'capacitor://localhost',
    'ionic://localhost',
    /\.onrender\.com$/,
    /\.vercel\.app$/,
  ];
  return allowed.some((rule) =>
    typeof rule === 'string' ? rule === origin : rule.test(origin),
  );
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    return res.status(403).json({ error: `CORS: origin not allowed: ${origin}` });
  }
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json());

// ✅ Database setup with SSL for production
const knexInstance = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'postgres',
    // Supabase's pooler drops idle TCP connections after ~5 minutes
    // (PgBouncer's default `server_idle_timeout`). Without keepAlive, the
    // next query on a pooled-but-idle connection surfaces as
    // `AggregateError [ECONNREFUSED]` because pg tries to reuse the dead
    // socket. `keepAlive: true` makes node-postgres send TCP keepalives
    // so the connection stays healthy.
    keepAlive: true,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
  },
  // Evict pooled connections after 60s of idleness so we never hand
  // a stale one to a request. Knex will create a fresh connection on
  // the next checkout.
  pool: {
    min: 0,
    max: 10,
    idleTimeoutMillis: 60_000,
    acquireTimeoutMillis: 30_000,
  },
});

Model.knex(knexInstance);

// ---------------------------------------------------------------------------
// Auto-migrate on boot.
//
// Render's startCommand is `npm run migrate:verbose && npm start` per
// render.yaml — but per the env-override memory, dashboard env vars
// (including startCommand) win over render.yaml. If the dashboard ever
// gets `npm start` only, migrations never run and the next deploy
// silently leaves the schema behind. We belt-and-brace this by running
// pending migrations here on every cold start.
//
// `migrate.latest()` is idempotent — Knex only runs files not already
// in `knex_migrations`, so a no-op when the DB is current. We catch
// errors so a bad migration doesn't crash the whole app (it'll still
// be reported via Render logs).
//
// server.ts awaits this promise before calling `app.listen()`, so the
// schema is guaranteed to be up-to-date by the time the first request
// can land.
// ---------------------------------------------------------------------------
export const readyPromise: Promise<void> = (async () => {
  try {
    const [batch, ran] = await knexInstance.migrate.latest({
      directory: './src/database/migrations',
      extension: 'ts',
    });
    if (ran.length > 0) {
      console.log(`[migrate] ✅ Boot migration batch ${batch}: ${ran.length} new file(s)`);
      for (const m of ran) console.log(`  - ${m}`);
    } else {
      console.log('[migrate] ✅ Schema is up to date');
    }
  } catch (err: any) {
    console.error('[migrate] ❌ Boot migration failed:', err?.message || err);
  }
})();

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

app.use('/api/auth', authRoutes);
console.log('✅ Auth routes registered at /api/auth');

app.use('/api/wallet', walletRoutes);
console.log('✅ Wallet routes registered at /api/wallet');

app.use('/api/games', gamesRoutes);
console.log('✅ Games routes registered at /api/games');

app.use('/api/admin', adminRoutes);
console.log('✅ Admin routes registered at /api/admin');

app.use('/api/soccer', soccerRoutes);
console.log('✅ Soccer routes registered at /api/soccer');

app.use('/api/invoices', invoiceRoutes);
console.log('✅ Invoice routes registered at /api/invoices');

// Debug: Log all registered routes at boot. Uses the same enumerator the
// 404 handler uses, so the boot log and the 404 payload can never drift
// apart.
try {
  const routes = listAvailableRoutes();
  if (routes.length > 0) {
    console.log('📍 Registered routes:');
    routes.forEach((route) => console.log(`   ${route}`));
  }
} catch (err) {
  console.log('⚠️  Could not enumerate routes (this is fine)');
}

// Extract the discovered routes into a `string[]` for the 404 payload so
// it can never drift from what the routers actually expose. We enumerate
// by reading each sub-router's `stack` directly (those are populated
// eagerly when `app.use(prefix, router)` is called), which is more
// reliable than walking `app._router?.stack` — that property isn't
// populated in Express 5 until the first request hits the router.
// Extract the discovered routes into a `string[]` for the 404 payload so
// it can never drift from what the routers actually expose.
//
// In Express 5, `app._router` is created lazily on the first request and
// the sub-router `stack` arrays are moved into the parent layer's
// `handle.stack` at that point. So at boot time we can read each
// sub-router's own `stack` directly, but at request time we need to
// walk `app._router.stack` to find the parent layers. This helper
// handles both shapes: it tries the imported router first (works at
// boot), and falls back to walking `app._router.stack` if the imported
// router's stack has been emptied.
function listAvailableRoutes(): string[] {
  const out: string[] = [];

  // Try the imported sub-routers first (populated at boot).
  const unwrap = (m: any) => (m && m.default ? m.default : m);
  const directRouters: Array<{ prefix: string; router: { stack: any[] } | undefined }> = [
    { prefix: '/api/auth', router: unwrap(authRoutes) },
    { prefix: '/api/wallet', router: unwrap(walletRoutes) },
    { prefix: '/api/games', router: unwrap(gamesRoutes) },
    { prefix: '/api/admin', router: unwrap(adminRoutes) },
    { prefix: '/api/soccer', router: unwrap(soccerRoutes) },
    { prefix: '/api/invoices', router: unwrap(invoiceRoutes) },
  ];
  for (const { prefix, router } of directRouters) {
    const stack = router?.stack || [];
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        out.push(`${methods} ${prefix}${layer.route.path}`);
      }
    }
  }

  // If we got nothing (Express 5 emptied the imported stacks after the
  // first request), walk `app._router.stack` and dig into each
  // sub-router's `handle.stack`.
  if (out.length === 0 && (app as any)._router?.stack) {
    for (const layer of (app as any)._router.stack) {
      if (layer.handle?.stack && layer.regexp) {
        // Recover the mount prefix from the regexp source. The format
        // is `^\\/<prefix>(?:\\/(?=$))?` or similar.
        const re = layer.regexp.toString();
        const m = re.match(/^\/\^\\\/([^\\]+)/);
        const prefix = m ? `/${m[1]}` : '';
        for (const sub of layer.handle.stack) {
          if (sub.route) {
            const methods = Object.keys(sub.route.methods).join(', ').toUpperCase();
            out.push(`${methods} ${prefix}${sub.route.path}`);
          }
        }
      }
    }
  }

  if (out.length === 0) {
    // Fallback: a hand-maintained list in case reflection fails. This is
    // the same list the previous hardcoded 404 carried, but now extended
    // to include the routes that were missing before (aviator/round,
    // aviator/settle, quiz/play, history, verify, and the full admin
    // surface).
    out.push(
      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/auth/otp/request',
      'POST /api/auth/reset-password',
      'GET /api/wallet/balance',
      'GET /api/wallet/balance/:userId',
      'GET /api/wallet/transactions',
      'POST /api/wallet/deposit',
      'POST /api/wallet/withdraw',
      'GET /api/wallet/deposit-status/:reference',
      'POST /api/games/spin/play',
      'POST /api/games/hourly/ticket',
      'GET /api/games/hourly/current',
      'GET /api/games/hourly/history',
      'POST /api/games/dice/play',
      'POST /api/games/lotto/play',
      'POST /api/games/quiz/play',
      'POST /api/games/aviator/round',
      'POST /api/games/aviator/settle',
      'POST /api/games/aviator/play',
      'POST /api/games/blackjack/play',
      'POST /api/games/soccer-quiz/play',
      'GET /api/soccer/matches/live',
      'GET /api/soccer/matches/upcoming',
      'GET /api/soccer/matches/recent',
      'POST /api/soccer/quiz-question',
      'GET /api/games/history',
      'GET /api/games/verify/:gameId',
      'POST /api/admin/login',
      'GET /api/admin/stats',
      'GET /api/admin/users',
      'GET /api/admin/users/:userId',
      'PATCH /api/admin/users/:userId/status',
      'GET /api/admin/transactions',
      'POST /api/admin/transactions/:transactionId/approve',
      'POST /api/admin/transactions/:transactionId/reject',
      'POST /api/admin/users/:userId/bonus',
      'GET /api/admin/games',
      'GET /api/admin/draws',
      'POST /api/admin/draws/:id/run',
      'POST /api/admin/draws/:id/cancel',
      'PATCH /api/admin/draws/:id',
    );
  }
  return out;
}

// 404 handler — must take (req, res, next) so Express 5 doesn't
// short-circuit to finalhandler when a 2-arg middleware doesn't call
// next(). The body is never sent by us, so the `next` is a safety
// net for any future code path that adds more middleware below.
app.use((req, res, _next) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
    availableRoutes: listAvailableRoutes(),
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('💥 Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

export default app;