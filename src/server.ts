import app from './app';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

// Refuse to boot in production with the default JWT secret. The hardcoded
// fallback in auth.service.ts exists only so dev tooling can spin up
// without env vars, but allowing it in production would let anyone
// forge tokens using the public default value.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('❌ JWT_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 NaWiNa Lotto API running on port ${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  // eslint-disable-next-line no-console
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
});