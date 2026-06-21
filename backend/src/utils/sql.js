// Escape karakter wildcard LIKE (% _ \) agar input pengguna diperlakukan literal.
// Pakai bersama klausa: ... LIKE ? ESCAPE '\\'
export function escapeLike(input) {
  return String(input ?? '').replace(/[\\%_]/g, (c) => `\\${c}`);
}
