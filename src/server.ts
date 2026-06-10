import app, { readyPromise } from './app';
import dotenv from 'dotenv';
import { schedule } from 'node-cron';
import { HourlyDrawService } from './services/games/hourly-draw.service';

dotenv.config();

// Render REQUIRES web services to bind explicitly to host `0.0.0.0` on the
// port in the `PORT` env var (default 10000 on Render, but `app.listen(PORT)`
// with no host param defaults to `::` / `127.0.0.1` on modern Node, which
// Render's load balancer can't reach. Result: boot log shows
// "=> Docs on specifying a port: https://render.com/docs/web-services#port-binding"
// and the service sits unhealthy until Render's port-scan timeout, after
// which /api/* requests get routed to a stale instance or fail with
// ECONNREFUSED on outbound calls. Always bind `0.0.0.0` explicitly.
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

// Refuse to boot in production with the default JWT secret. The hardcoded
// fallback in auth.service.ts exists only so dev tooling can spin up
// without env vars, but allowing it in production would let anyone
// forge tokens using the public default value.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('❌ JWT_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}

// Wait for boot-time migrations to finish before opening the port.
// `migrate.latest()` is idempotent and only runs pending files — see
// app.ts. Without this gate, an early request can land on a route that
// needs a new table before the migration has finished (or even
// started) and surface a "relation does not exist" error to the user.
readyPromise.then(() => {
  // ── Daily Draw Cron (08:00 and 18:00 UTC) ──
  const hourlyDrawService = new HourlyDrawService();

  // Clean up stale draws from old code / wrong timezones before seeding
  hourlyDrawService.cleanupStaleDraws().then((removed) => {
    if (removed > 0) console.log(`🧹 Cleaned up ${removed} stale draw(s)`);
  }).catch((err) => {
    console.error('[cron] Stale-draw cleanup failed:', err);
  });

  // Seed the current or most-recent draw on boot (in case the server was down)
  hourlyDrawService.seedCurrentDraw().then((draw) => {
    console.log(`🎱 Daily draw seeded: ${draw.id} @ ${draw.scheduled_at}`);
  }).catch((err) => {
    console.error('[cron] Failed to seed daily draw:', err);
  });

  // Twice daily at 08:00 and 18:00 — execute any open past draws and create the next one
  schedule('0 8,18 * * *', async () => {
    console.log('[cron] Running daily draw job (08:00 or 18:00)...');
    try {
      const { HourlyDraw } = await import('./models/HourlyDraw');
      const now = new Date().toISOString();

      // Execute all open draws whose time has passed
      const openDraws = await HourlyDraw.query()
        .where('status', 'open')
        .where('scheduled_at', '<=', now);

      for (const draw of openDraws) {
        console.log(`[cron] Executing draw ${draw.id} scheduled for ${draw.scheduled_at}`);
        const result = await hourlyDrawService.runDraw(draw.id);
        console.log(`[cron] Draw executed:`, result);
      }

      // Seed the next upcoming draw
      const nextDraw = await hourlyDrawService.createNextDraw();
      console.log(`[cron] Next draw ready: ${nextDraw.id} @ ${nextDraw.scheduled_at}`);
    } catch (err: any) {
      console.error('[cron] Daily draw job failed:', err?.message || err);
    }
  });

  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 NaWiNa Lotto API running on http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});
