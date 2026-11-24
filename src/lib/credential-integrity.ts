export type UniqueRecordResolution<T> =
  | { status: "missing" }
  | { status: "unique"; record: T }
  | { status: "ambiguous"; count: number };

/** Resolve records for a key that is expected to be unique. */
export function resolveUniqueRecord<T>(records: readonly T[]): UniqueRecordResolution<T> {
  if (records.length === 0) return { status: "missing" };
  if (records.length > 1) return { status: "ambiguous", count: records.length };
  return { status: "unique", record: records[0] };
}


/** Canonical e-mail key shared by account creation and credential login. */
export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}


/** Return every legacy/current user record whose email has the same canonical login key. */
export function findUsersByNormalizedEmail<T extends { email: string }>(
  users: readonly T[],
  email: string,
): T[] {
  const normalizedEmail = normalizeLoginEmail(email);
  if (!normalizedEmail) return [];
  return users.filter((user) => normalizeLoginEmail(user.email) === normalizedEmail);
}
