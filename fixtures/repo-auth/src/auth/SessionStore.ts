import { randomBytes } from 'node:crypto';
import type { SecurityConfig } from '../security/SecurityConfig.js';

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Opaque, server-side session tokens. See docs/adr/001-opaque-tokens.md for why
 * sessions are not self-contained JWTs.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly config: SecurityConfig) {}

  create(userId: string, now: number = Date.now()): Session {
    const token = randomBytes(32).toString('hex');
    const session: Session = { token, userId, createdAt: now, expiresAt: now + this.config.sessionTtlSeconds * 1000 };
    this.sessions.set(token, session);
    return session;
  }

  find(token: string, now: number = Date.now()): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < now) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  revokeAllForUser(userId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }
}
