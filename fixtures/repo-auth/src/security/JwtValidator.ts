import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SecurityConfig } from './SecurityConfig.js';

export interface JwtPayload {
  sub: string;
  iss: string;
  exp: number;
  email: string;
}

export class JwtValidationError extends Error {}

function base64UrlDecode(input: string): Buffer {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Validates JWTs issued by federated SSO providers during login. The service's own
 * sessions never use JWTs; see docs/adr/001-opaque-tokens.md.
 */
export class JwtValidator {
  constructor(private readonly config: SecurityConfig) {}

  validate(token: string, now: number = Date.now()): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new JwtValidationError('malformed token');
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    const expectedSignature = createHmac('sha256', this.config.ssoSharedSecret)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    const actualSignature = base64UrlDecode(signaturePart);
    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      throw new JwtValidationError('signature mismatch');
    }

    const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8')) as JwtPayload;
    if (!this.config.allowedSsoIssuers.includes(payload.iss)) {
      throw new JwtValidationError(`unknown issuer: ${payload.iss}`);
    }
    if (payload.exp * 1000 < now) {
      throw new JwtValidationError('token expired');
    }
    return payload;
  }
}
