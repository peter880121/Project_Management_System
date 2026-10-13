export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

export type LoginFailureState = Readonly<{
  failedLoginCount: number;
  lockedUntil: Date | null;
  locked: boolean;
}>;

/** Apply one failed-password attempt; expired locks restart the count at one. */
export function recordFailedPasswordAttempt(input: {
  failedLoginCount: number;
  lockedUntil: Date | null;
  now: Date;
}): LoginFailureState {
  if (input.lockedUntil && input.lockedUntil.getTime() > input.now.getTime()) {
    return {
      failedLoginCount: input.failedLoginCount,
      lockedUntil: input.lockedUntil,
      locked: true,
    };
  }

  const previousCount = input.lockedUntil && input.lockedUntil.getTime() <= input.now.getTime()
    ? 0
    : input.failedLoginCount;
  const failedLoginCount = previousCount + 1;
  const locked = failedLoginCount >= LOGIN_FAILURE_LIMIT;
  return {
    failedLoginCount,
    lockedUntil: locked ? new Date(input.now.getTime() + LOGIN_LOCK_DURATION_MS) : null,
    locked,
  };
}

/** Only an active account with a wrong password contributes to the lockout counter. */
export function shouldCountFailedPasswordAttempt(status: "ACTIVE" | "PENDING" | "DISABLED"): boolean {
  return status === "ACTIVE";
}
