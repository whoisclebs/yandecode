# ADR 001: Opaque session tokens instead of JWTs

## Status

Accepted

## Context

Federated SSO logins arrive as signed JWTs (see `JwtValidator`), so it would be
tempting to keep using JWTs for the service's own session tokens after login.

## Decision

Sessions are opaque, random, server-side-tracked tokens (`SessionStore`), not JWTs.

## Consequences

- Revocation is immediate: `SessionStore.revoke` deletes server-side state, whereas a
  self-contained JWT stays valid until it expires no matter what the server does.
- Every request needs a `SessionStore` lookup instead of a purely local signature
  check, which is an acceptable cost at this service's scale.
- `JwtValidator` still exists and is still used, but only at the SSO ingress boundary,
  never for the service's own sessions.
