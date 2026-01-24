import dotenv from 'dotenv';

console.log('Verifying Environment Variables\n');

const result = dotenv.config();

if (result.error) {
  console.error('Failed to load .env file:', result.error);
  process.exit(1);
}

console.log('.env file loaded successfully\n');

const vars = {
  'DB_HOST': process.env.DB_HOST,
  'DB_PORT': process.env.DB_PORT,
  'DB_NAME': process.env.DB_NAME,
  'DB_USER': process.env.DB_USER,
  'DB_PASSWORD': process.env.DB_PASSWORD,
};

console.log('Environment Variables:');
for (const [key, value] of Object.entries(vars)) {
  if (key === 'DB_PASSWORD') {
    console.log('  ' + key + ': ' + (value ? 'SET (' + value.length + ' characters)' : 'NOT SET'));
    if (value) {
      console.log('    Value: ' + value);
    }
  } else {
    console.log('  ' + key + ': ' + (value || 'NOT SET'));
  }
}
