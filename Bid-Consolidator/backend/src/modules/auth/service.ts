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
 * Create an account. Sign-up is invite-only: an admin creates an invite for an
 * exact email address and shares the link, and the person joins that org with
 * the invited role. The invite token is the proof — nobody can join just by
 * typing an address at a company domain.
 */
export async function register(input: { name: string; email: string; password: string; inviteToken: string }) {
  return withTx(async (tx) => {
    const invite = await queryOne<{ id: number; org_id: number; email: string; role: Role }>(
      tx,
      `SELECT id, org_id, email, role FROM org_invites
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(input.inviteToken)],
    );
    if (!invite) throw badRequest('This invite link is invalid or has expired. Ask your admin for a new one.');
    if (invite.email.toLowerCase() !== input.email) throw forbidden(`This invite is for ${invite.email}. Sign up with that address.`);
    await tx.query('UPDATE org_invites SET used_at = now() WHERE id = $1', [invite.id]);
    try {
      const user = await queryOne<UserRow>(
        tx,
        `INSERT INTO users (email, password, name, role, org_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.email, await hashPassword(input.password), input.name, invite.role, invite.org_id],
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
