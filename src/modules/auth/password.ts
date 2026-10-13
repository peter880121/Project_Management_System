import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

function assertPasswordWithinBcryptLimit(password: string): void {
  if (bcrypt.truncates(password)) {
    throw new RangeError("Password exceeds bcrypt's 72-byte UTF-8 limit");
  }
}

/** Hash a password asynchronously; passwords over 72 UTF-8 bytes throw instead of truncating. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordWithinBcryptLimit(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Compare a password asynchronously; passwords over 72 UTF-8 bytes throw instead of truncating. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  assertPasswordWithinBcryptLimit(password);
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    // Intentionally swallow every bcrypt comparison exception, including programming errors.
    // If callers need to distinguish error types, refine error handling here.
    return false;
  }
}
