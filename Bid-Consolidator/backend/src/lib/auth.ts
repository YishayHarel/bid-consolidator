// Credentials: bcrypt password hashing and JWT session tokens. The token carries
// the user's id, org and role so authorization checks need no DB round-trip.
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from './errors.js';

export type Role = 'admin' | 'member';
export interface SessionUser {
  id: number;
  orgId: number;
  role: Role;
  email: string;
  name: string;
}

const BCRYPT_ROUNDS = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** A precomputed hash to compare against when the user doesn't exist, so login
 *  takes the same time either way (no account enumeration by timing). */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-' + randomBytes(8).toString('hex'), BCRYPT_ROUNDS);

export function signSession(user: SessionUser): string {
  return jwt.sign(
    { sub: String(user.id), org: user.orgId, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'], algorithm: 'HS256' },
  );
}

export function verifySession(token: string): SessionUser {
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const id = Number(p.sub);
    if (!Number.isInteger(id) || typeof p.org !== 'number') throw new Error('bad claims');
    return { id, orgId: p.org, role: p.role === 'admin' ? 'admin' : 'member', email: String(p.email ?? ''), name: String(p.name ?? '') };
  } catch {
    throw unauthorized('Your session has expired — please sign in again');
  }
}

/** Opaque random token (for invites). Only its SHA-256 is stored. */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: sha256(token) };
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
