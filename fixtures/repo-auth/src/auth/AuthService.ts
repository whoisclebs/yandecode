import { JwtValidator } from '../security/JwtValidator.js';
import type { PasswordHasher } from '../security/PasswordHasher.js';
import { InvalidCredentialsError, SsoValidationError } from '../http/errors.js';
import { SessionStore, type Session } from './SessionStore.js';
import type { UserRepository } from '../users/UserRepository.js';

export interface LoginResult {
  session: Session;
  userId: string;
}

/** Orchestrates password login, federated SSO login, logout and session lookup. */
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly jwt: JwtValidator,
    private readonly sessions: SessionStore,
  ) {}

  loginWithPassword(email: string, plainPassword: string): LoginResult {
    const user = this.users.findByEmail(email);
    if (!user || !user.passwordHash || !this.passwords.verify(plainPassword, user.passwordHash)) {
      throw new InvalidCredentialsError();
    }
    return { session: this.sessions.create(user.id), userId: user.id };
  }

  loginWithSso(ssoToken: string): LoginResult {
    let payload;
    try {
      payload = this.jwt.validate(ssoToken);
    } catch (error) {
      throw new SsoValidationError((error as Error).message);
    }
    const user = this.users.findOrCreateBySso(payload.email, payload.sub);
    return { session: this.sessions.create(user.id), userId: user.id };
  }

  logout(token: string): void {
    this.sessions.revoke(token);
  }

  currentUserId(token: string): string | null {
    return this.sessions.find(token)?.userId ?? null;
  }
}
