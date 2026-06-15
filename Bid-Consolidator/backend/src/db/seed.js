require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    const password = await bcrypt.hash(process.env.INTERNAL_PASSWORD || 'admin123', 10);

    await client.query(`
      INSERT INTO users (email, password, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
    `, ['admin@shalom.com', password, 'Jack Shalom', 'admin']);

    const userRes = await client.query(`SELECT id FROM users WHERE email = 'admin@shalom.com'`);
    const userId = userRes.rows[0].id;

    const divisions = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen'];
    const projectNames = ['Ross', 'Burlington', 'Body Glove', 'General'];

    for (const name of projectNames) {
      await client.query(`
        INSERT INTO projects (name, division, status, created_by)
        VALUES ($1, $2, 'active', $3)
        ON CONFLICT DO NOTHING
      `, [name, divisions[Math.floor(Math.random() * divisions.length)], userId]);
    }

    console.log('Seed complete. Login: admin@shalom.com / ' + (process.env.INTERNAL_PASSWORD || 'admin123'));
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
