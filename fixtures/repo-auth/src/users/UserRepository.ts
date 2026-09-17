export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  ssoSubject: string | null;
}

let nextId = 1;

/** In-memory user store keyed by id and by lower-cased email. */
export class UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();

  findByEmail(email: string): UserRecord | null {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? (this.byId.get(id) ?? null) : null;
  }

  findById(id: string): UserRecord | null {
    return this.byId.get(id) ?? null;
  }

  createWithPassword(email: string, passwordHash: string): UserRecord {
    const user: UserRecord = { id: `u${nextId++}`, email: email.toLowerCase(), passwordHash, ssoSubject: null };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user.id);
    return user;
  }

  findOrCreateBySso(email: string, ssoSubject: string): UserRecord {
    const existing = this.findByEmail(email);
    if (existing) return existing;
    const user: UserRecord = { id: `u${nextId++}`, email: email.toLowerCase(), passwordHash: null, ssoSubject };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user.id);
    return user;
  }
}
