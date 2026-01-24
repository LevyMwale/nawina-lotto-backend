// test-connection.js
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => {
    console.log('✅ Connected to Supabase successfully!');
    return client.query('SELECT version()');
  })
  .then(result => {
    console.log('Database version:', result.rows[0].version);
    client.end();
  })
  .catch(err => {
    console.error('❌ Connection error:', err.message);
    client.end();
  });