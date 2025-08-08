export type User = { id: string; name: string; role: 'admin' | 'developer' | 'viewer' };

export function getUserFromHeaders(headers: Headers): User {
  const name = headers.get('x-user') || 'admin';
  const role = (headers.get('x-role') as User['role']) || 'admin';
  return { id: name, name, role };
}

export function requireRole(user: User, required: User['role']) {
  const rank = { viewer: 0, developer: 1, admin: 2 } as const;
  return rank[user.role] >= rank[required];
}

