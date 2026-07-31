// Normalize an email input (array, or a comma/semicolon/newline-separated
// string) into a clean, de-duplicated array of addresses.
function normalizeEmails(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (input != null) arr = String(input).split(/[,;\n]/);
  return [...new Set(arr.map(e => String(e).trim()).filter(Boolean))];
}

// Insert or update a factory in the owner's directory. Uniqueness is per-owner
// (created_by, lower(name)), so different users can each have a factory of the
// same name. `emails` accepts an array or a comma-separated string.
async function upsertFactory(client, ownerId, name, emails, contactName) {
  const cleanName = String(name || '').trim();
  const cleanEmails = normalizeEmails(emails);
  const cleanContact = String(contactName || '').trim() || null;
  const { rows } = await client.query(
    `INSERT INTO factories (name, emails, contact_name, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (created_by, LOWER(name)) DO UPDATE
       SET emails = CASE WHEN cardinality($2::text[]) > 0 THEN EXCLUDED.emails ELSE factories.emails END,
           contact_name = COALESCE(EXCLUDED.contact_name, factories.contact_name)
     RETURNING id, name, emails, contact_name, created_by`,
    [cleanName, cleanEmails, cleanContact, ownerId]
  );
  return rows[0];
}

module.exports = { upsertFactory, normalizeEmails };
