import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Deliberately dependency-free: the point of the demo is samble, not password
 * hashing. A real application would use argon2 or bcrypt.
 */
export const hashPassword = (plain: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

export const verifyPassword = (plain: string, stored: string): boolean => {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return (
    attempt.length === expected.length && timingSafeEqual(attempt, expected)
  );
};
