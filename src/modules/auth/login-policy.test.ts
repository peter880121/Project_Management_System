import { describe, expect, it } from "vitest";
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_LOCK_DURATION_MS,
  recordFailedPasswordAttempt,
  shouldCountFailedPasswordAttempt,
} from "./login-policy";

const now = new Date("2026-10-13T00:00:00.000Z");

describe("login failure policy", () => {
  it("counts the fifth bad password and starts a 15-minute lock immediately", () => {
    const result = recordFailedPasswordAttempt({ failedLoginCount: LOGIN_FAILURE_LIMIT - 1, lockedUntil: null, now });
    expect(result).toEqual({
      failedLoginCount: LOGIN_FAILURE_LIMIT,
      lockedUntil: new Date(now.getTime() + LOGIN_LOCK_DURATION_MS),
      locked: true,
    });
  });

  it("does not increment or extend an active lock when another attempt arrives", () => {
    const lockedUntil = new Date(now.getTime() + 60_000);
    const result = recordFailedPasswordAttempt({ failedLoginCount: LOGIN_FAILURE_LIMIT, lockedUntil, now });
    expect(result).toEqual({ failedLoginCount: LOGIN_FAILURE_LIMIT, lockedUntil, locked: true });
  });

  it("explicitly clears an expired lock and counts the next failure as attempt one", () => {
    const expiredAt = new Date(now.getTime());
    const result = recordFailedPasswordAttempt({ failedLoginCount: LOGIN_FAILURE_LIMIT, lockedUntil: expiredAt, now });
    expect(result).toEqual({ failedLoginCount: 1, lockedUntil: null, locked: false });
  });

  it("does not count failures for PENDING or DISABLED accounts", () => {
    expect(shouldCountFailedPasswordAttempt("PENDING")).toBe(false);
    expect(shouldCountFailedPasswordAttempt("DISABLED")).toBe(false);
    expect(shouldCountFailedPasswordAttempt("ACTIVE")).toBe(true);
  });
});
