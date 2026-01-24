import { Knex } from 'knex';
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

export const knexConfig: Knex.Config = {
  client: 'postgresql',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'nawina_lotto',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: './src/database/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './src/database/seeds',
    extension: 'ts',
  },
};
