import app from './app';
import dotenv from 'dotenv';

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

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 NaWiNa Lotto API running on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});