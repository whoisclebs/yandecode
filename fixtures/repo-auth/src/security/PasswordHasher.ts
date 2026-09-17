import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SecurityConfig } from './SecurityConfig.js';

const KEY_LENGTH = 64;

/** Hashes and verifies user passwords with scrypt plus a service-wide pepper. */
export class PasswordHasher {
  constructor(private readonly config: SecurityConfig) {}

  hash(plainPassword: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(`${plainPassword}${this.config.passwordPepper}`, salt, KEY_LENGTH);
    return `${salt.toString('hex')}:${derived.toString('hex')}`;
  }

  verify(plainPassword: string, storedHash: string): boolean {
    const [saltHex, derivedHex] = storedHash.split(':');
    if (!saltHex || !derivedHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(derivedHex, 'hex');
    const actual = scryptSync(`${plainPassword}${this.config.passwordPepper}`, salt, KEY_LENGTH);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
