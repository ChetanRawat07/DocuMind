/** Up to two initials from a name or email: "Ada Lovelace" → "AL", "ada@x.test" → "A". */
export function initialsOf(nameOrEmail: string): string {
  const words = nameOrEmail.split('@')[0]?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return initials.toUpperCase() || '?';
}
