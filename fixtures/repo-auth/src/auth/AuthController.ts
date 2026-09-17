import type { AuthService } from './AuthService.js';
import { AuthError, UnauthorizedError } from '../http/errors.js';
import type { HttpResponse, Router } from '../http/Router.js';

interface LoginBody {
  email: string;
  password: string;
}

interface SsoLoginBody {
  token: string;
}

function bearerToken(headers: Record<string, string>): string {
  const header = headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) throw new UnauthorizedError();
  return header.slice('Bearer '.length);
}

/** HTTP-facing handlers for login, SSO login, logout and the current-user endpoint. */
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  register(router: Router): void {
    router.register('POST', '/auth/login', async (req) => this.handleLogin(req.body as LoginBody));
    router.register('POST', '/auth/sso', async (req) => this.handleSsoLogin(req.body as SsoLoginBody));
    router.register('POST', '/auth/logout', async (req) => this.handleLogout(req.headers));
    router.register('GET', '/auth/me', async (req) => this.handleMe(req.headers));
  }

  private async handleLogin(body: LoginBody): Promise<HttpResponse> {
    try {
      const result = this.auth.loginWithPassword(body.email, body.password);
      return { status: 200, body: { token: result.session.token, userId: result.userId } };
    } catch (error) {
      return this.toResponse(error);
    }
  }

  private async handleSsoLogin(body: SsoLoginBody): Promise<HttpResponse> {
    try {
      const result = this.auth.loginWithSso(body.token);
      return { status: 200, body: { token: result.session.token, userId: result.userId } };
    } catch (error) {
      return this.toResponse(error);
    }
  }

  private async handleLogout(headers: Record<string, string>): Promise<HttpResponse> {
    this.auth.logout(bearerToken(headers));
    return { status: 204, body: null };
  }

  private async handleMe(headers: Record<string, string>): Promise<HttpResponse> {
    const userId = this.auth.currentUserId(bearerToken(headers));
    if (!userId) return this.toResponse(new UnauthorizedError());
    return { status: 200, body: { userId } };
  }

  private toResponse(error: unknown): HttpResponse {
    if (error instanceof AuthError) return { status: error.httpStatus, body: { error: error.message } };
    throw error;
  }
}
