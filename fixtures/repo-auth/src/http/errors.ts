export class AuthError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super('invalid email or password', 401);
  }
}

export class TokenExpiredError extends AuthError {
  constructor() {
    super('session token expired', 401);
  }
}

export class UnauthorizedError extends AuthError {
  constructor() {
    super('missing or invalid session token', 401);
  }
}

export class SsoValidationError extends AuthError {
  constructor(reason: string) {
    super(`SSO validation failed: ${reason}`, 401);
  }
}
