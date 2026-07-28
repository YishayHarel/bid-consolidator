async function upsertFactory(client, name, email) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim() || null;
  const { rows } = await client.query(
    `INSERT INTO factories (name, email) VALUES ($1, $2)
     ON CONFLICT (LOWER(name)) DO UPDATE
       SET email = COALESCE(NULLIF(EXCLUDED.email, ''), factories.email)
     RETURNING id, name, email`,
    [cleanName, cleanEmail]
  );
  return rows[0];
}

module.exports = { upsertFactory };
