import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/AuthController.js';
import { AuthService } from '../src/auth/AuthService.js';
import { SessionStore } from '../src/auth/SessionStore.js';
import { Router } from '../src/http/Router.js';
import { JwtValidator } from '../src/security/JwtValidator.js';
import { PasswordHasher } from '../src/security/PasswordHasher.js';
import { loadSecurityConfig } from '../src/security/SecurityConfig.js';
import { UserRepository } from '../src/users/UserRepository.js';

function signSsoToken(secret: string, payload: Record<string, unknown>): string {
  const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('auth integration', () => {
  const config = loadSecurityConfig({ AUTH_SSO_ISSUERS: 'https://sso.example.com' } as NodeJS.ProcessEnv);
  let router: Router;
  let passwordHasher: PasswordHasher;
  let users: UserRepository;

  beforeEach(() => {
    users = new UserRepository();
    passwordHasher = new PasswordHasher(config);
    const jwt = new JwtValidator(config);
    const sessions = new SessionStore(config);
    const service = new AuthService(users, passwordHasher, jwt, sessions);
    router = new Router();
    new AuthController(service).register(router);
  });

  it('logs in with a valid password and rejects an invalid one', async () => {
    users.createWithPassword('alice@example.com', passwordHasher.hash('correct-horse'));

    const ok = await router.dispatch({ method: 'POST', path: '/auth/login', headers: {}, body: { email: 'alice@example.com', password: 'correct-horse' } });
    expect(ok.status).toBe(200);

    const bad = await router.dispatch({ method: 'POST', path: '/auth/login', headers: {}, body: { email: 'alice@example.com', password: 'wrong' } });
    expect(bad.status).toBe(401);
  });

  it('logs in via SSO, then reads and revokes the session', async () => {
    const token = signSsoToken(config.ssoSharedSecret, {
      sub: 'sso-subject-1',
      iss: 'https://sso.example.com',
      email: 'bob@example.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const login = await router.dispatch({ method: 'POST', path: '/auth/sso', headers: {}, body: { token } });
    expect(login.status).toBe(200);
    const sessionToken = (login.body as { token: string }).token;

    const me = await router.dispatch({ method: 'GET', path: '/auth/me', headers: { authorization: `Bearer ${sessionToken}` }, body: null });
    expect(me.status).toBe(200);

    await router.dispatch({ method: 'POST', path: '/auth/logout', headers: { authorization: `Bearer ${sessionToken}` }, body: null });
    const after = await router.dispatch({ method: 'GET', path: '/auth/me', headers: { authorization: `Bearer ${sessionToken}` }, body: null });
    expect(after.status).toBe(401);
  });
});
