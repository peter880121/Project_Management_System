import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password helpers", () => {
  it("hashes a password with bcrypt cost 12 and verifies the original", async () => {
    const password = "synthetic-password-123";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(bcrypt.getRounds(hash)).toBe(12);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("different-password-123", hash)).resolves.toBe(false);
  });

  it("uses a different salt for each hash of the same password", async () => {
    const firstHash = await hashPassword("synthetic-password-123");
    const secondHash = await hashPassword("synthetic-password-123");

    expect(firstHash).not.toBe(secondHash);
    await expect(verifyPassword("synthetic-password-123", firstHash)).resolves.toBe(true);
    await expect(verifyPassword("synthetic-password-123", secondHash)).resolves.toBe(true);
  });

  it("accepts a password exactly 72 UTF-8 bytes long, including multibyte characters", async () => {
    const password = "你".repeat(24);
    expect(Buffer.byteLength(password, "utf8")).toBe(72);
    const hash = await hashPassword(password);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  // These cases verify the bcrypt 72-byte boundary, not a 72-character boundary.
  it("accepts 24 Chinese characters when their UTF-8 length is exactly 72 bytes", async () => {
    const password = "中".repeat(24);
    expect(Buffer.byteLength(password, "utf8")).toBe(72);
    const hash = await hashPassword(password);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it("rejects 25 Chinese characters when their UTF-8 length is 75 bytes", async () => {
    const password = "中".repeat(25);
    expect(Buffer.byteLength(password, "utf8")).toBe(75);

    await expect(hashPassword(password)).rejects.toBeInstanceOf(RangeError);
    await expect(verifyPassword(password, "not-a-valid-bcrypt-hash")).rejects.toBeInstanceOf(RangeError);
  });

  it("throws for passwords exceeding 72 UTF-8 bytes when hashing or verifying", async () => {
    const asciiPassword = "a".repeat(73);
    const multibytePassword = "你".repeat(25);
    expect(Buffer.byteLength(multibytePassword, "utf8")).toBeGreaterThan(72);

    await expect(hashPassword(asciiPassword)).rejects.toThrow(/72-byte UTF-8 limit/);
    await expect(verifyPassword(asciiPassword, "not-a-valid-bcrypt-hash")).rejects.toThrow(/72-byte UTF-8 limit/);
    await expect(hashPassword(multibytePassword)).rejects.toThrow(/72-byte UTF-8 limit/);
  });

  it("returns false without throwing when the stored hash is malformed", async () => {
    await expect(verifyPassword("any", "not-a-valid-bcrypt-hash")).resolves.toBe(false);
  });
});
