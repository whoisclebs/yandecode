export interface SecurityConfig {
  passwordPepper: string;
  ssoSharedSecret: string;
  allowedSsoIssuers: string[];
  sessionTtlSeconds: number;
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  return {
    passwordPepper: env.AUTH_PASSWORD_PEPPER ?? 'dev-only-pepper',
    ssoSharedSecret: env.AUTH_SSO_SHARED_SECRET ?? 'dev-only-sso-secret',
    allowedSsoIssuers: (env.AUTH_SSO_ISSUERS ?? 'https://sso.example.com').split(','),
    sessionTtlSeconds: Number.parseInt(env.AUTH_SESSION_TTL_SECONDS ?? '3600', 10),
  };
}
