# repo-auth (RAG benchmark fixture)

A small, self-contained TypeScript authentication service used only as a fixture for
YandeCode's retrieval benchmark (`benchmarks/rag`) and its slow evaluation test. It is
not a workspace package: nothing under `packages/*` imports from it, and it is never
built by `tsc -b`.

## Modules

- `src/security` — password hashing (`PasswordHasher`), federated SSO token validation
  (`JwtValidator`), and configuration (`SecurityConfig`).
- `src/auth` — `AuthService` (login/logout orchestration), `SessionStore` (opaque
  session tokens), `AuthController` (HTTP-facing handlers).
- `src/users` — `UserRepository`, an in-memory user store.
- `src/http` — a minimal `Router` and the `AuthError` hierarchy.

See `docs/adr/001-opaque-tokens.md` for why sessions use opaque tokens instead of JWTs.
