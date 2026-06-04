// scripts/migrate-with-logs.ts
import knex from 'knex';
import knexConfig from '../knexfile';

const env = process.env.NODE_ENV || 'development';
const config = knexConfig[env as keyof typeof knexConfig];

console.log(`[migrate] Starting migrations on env: ${env}`);
console.log(`[migrate] DB host: ${(config.connection as any).host}:${(config.connection as any).port}`);
console.log(`[migrate] DB name: ${(config.connection as any).database}`);
console.log(`[migrate] DB user: ${(config.connection as any).user}`);

const db = knex(config);

db.migrate.latest()
  .then((result) => {
    console.log(`[migrate] ✅ Batch ${result[0]} run: ${result[1].length} migrations`);
    result[1].forEach((m: string) => console.log(`  - ${m}`));
    return db.seed.run();
  })
  .then((result) => {
    console.log(`[seed] ✅ Ran ${result[0]} seed files`);
    return db.destroy();
  })
  .then(() => {
    console.log('[migrate] Done. Exiting with code 0.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrate] ❌ Error:', err.message);
    console.error(err);
    process.exit(1);
  });
