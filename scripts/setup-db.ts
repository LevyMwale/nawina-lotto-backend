import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();

async function setupDatabase() {
  // Connect to Supabase postgres database
  const db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'postgres',
    },
  });

  try {
    // Test connection
    await db.raw('SELECT 1');
    console.log('✅ Successfully connected to Supabase database!');

    // You can add schema/table creation here if needed
    // For example, create your tables if they don't exist

  } catch (error) {
    console.error('❌ Error connecting to database:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

setupDatabase();