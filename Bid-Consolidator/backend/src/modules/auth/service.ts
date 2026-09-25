import { config } from '../../config.js';
import { pool, queryOne, withTx } from '../../db/pool.js';
import { DUMMY_HASH, hashPassword, sha256, signSession, verifyPassword, type Role, type SessionUser } from '../../lib/auth.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, unauthorized } from '../../lib/errors.js';

interface UserRow { id: number; org_id: number; email: string; password: string; name: string; role: Role }
export interface OrgRow {
  id: number; name: string; logo_mark: string | null; logo_title: string | null; logo_sub: string | null;
  brand_color: string | null; allowed_domains: string[]; settings: Record<string, unknown>;
}

export const orgDTO = (o: OrgRow) => ({
  id: o.id,
  name: o.name,
  branding: { mark: o.logo_mark ?? o.name.slice(0, 1), title: o.logo_title ?? o.name, subtitle: o.logo_sub ?? 'Bid Consolidator', color: o.brand_color ?? '#0f172a' },
});
export const userDTO = (u: Pick<UserRow, 'id' | 'email' | 'name' | 'role' | 'org_id'>) => ({ id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.org_id });

const toSession = (u: UserRow): SessionUser => ({ id: u.id, orgId: u.org_id, role: u.role, email: u.email, name: u.name });

async function getOrg(orgId: number): Promise<OrgRow> {
  const org = await queryOne<OrgRow>(pool, 'SELECT * FROM organizations WHERE id = $1', [orgId]);
  if (!org) throw notFound('Organization');
  return org;
}

async function session(user: UserRow) {
  return { token: signSession(toSession(user)), user: userDTO(user), org: orgDTO(await getOrg(user.org_id)) };
}

export async function login(email: string, password: string) {
  const user = await queryOne<UserRow>(pool, 'SELECT * FROM users WHERE lower(email) = $1', [email]);
  // Always run bcrypt (against a dummy hash if needed) so response time doesn't
  // reveal whether the account exists.
  const ok = await verifyPassword(password, user?.password ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Incorrect email or password. Please try again.');
  return session(user);
}

/**
 * Create an account. Allowed when either (a) a valid, unused invite for this
 * email is presented — the user joins the inviting org with the invited role —
 * or (b) the email's domain is one of an organization's sign-up domains.
 * Anyone else is refused: sign-up is not open to the public.
 */
export async function register(input: { name: string; email: string; password: string; inviteToken?: string | undefined }) {
  const domain = input.email.split('@')[1] ?? '';
  return withTx(async (tx) => {
    let orgId: number | null = null;
    let role: Role = 'member';
    if (input.inviteToken) {
      const invite = await queryOne<{ id: number; org_id: number; email: string; role: Role }>(
        tx,
        `SELECT id, org_id, email, role FROM org_invites
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(input.inviteToken)],
      );
      if (!invite) throw badRequest('This invite link is invalid or has expired. Ask your admin for a new one.');
      if (invite.email.toLowerCase() !== input.email) throw forbidden(`This invite is for ${invite.email}. Sign up with that address.`);
      orgId = invite.org_id;
      role = invite.role;
      await tx.query('UPDATE org_invites SET used_at = now() WHERE id = $1', [invite.id]);
    } else {
      const org = await queryOne<{ id: number }>(tx, 'SELECT id FROM organizations WHERE $1 = ANY(allowed_domains) ORDER BY id LIMIT 1', [domain]);
      if (org) orgId = org.id;
      else if (config.bootstrapSignupDomains.includes(domain)) {
        orgId = (await queryOne<{ id: number }>(tx, 'SELECT min(id) AS id FROM organizations'))?.id ?? null;
      }
      if (!orgId) throw forbidden('Sign-up is limited to company email addresses. Ask an admin to invite you.');
    }
    try {
      const user = await queryOne<UserRow>(
        tx,
        `INSERT INTO users (email, password, name, role, org_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.email, await hashPassword(input.password), input.name, role, orgId],
      );
      return user!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An account with this email already exists. Try signing in.');
      throw err;
    }
  }).then(session);
}

export async function me(userId: number) {
  const user = await queryOne<UserRow>(pool, 'SELECT * FROM users WHERE id = $1', [userId]);
  if (!user) throw unauthorized();
  return { user: userDTO(user), org: orgDTO(await getOrg(user.org_id)) };
}

export async function changePassword(userId: number, current: string, next: string) {
  const user = await queryOne<UserRow>(pool, 'SELECT * FROM users WHERE id = $1', [userId]);
  if (!user || !(await verifyPassword(current, user.password))) throw badRequest('Your current password is incorrect.');
  await pool.query('UPDATE users SET password = $2 WHERE id = $1', [userId, await hashPassword(next)]);
}
