import type { User, Role } from '../types';

// Daftar peran efektif user (fallback ke role tunggal untuk token lama).
export function userRoles(u: User | null | undefined): Role[] {
  if (!u) return [];
  return u.roles && u.roles.length ? u.roles : u.role ? [u.role] : [];
}

// True bila user punya salah satu dari peran yang diminta.
export function hasRole(u: User | null | undefined, ...roles: Role[]): boolean {
  const set = userRoles(u);
  return roles.some((r) => set.includes(r));
}
