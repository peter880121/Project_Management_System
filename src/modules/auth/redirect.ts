const origin = "https://medpm.invalid";

export function isSafeRedirect(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let decoded = value;
  // Validate encoded forms too; reject excessive nesting rather than guessing.
  for (let depth = 0; depth < 8; depth += 1) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[:\\\s\u0000-\u001f\u007f]/u.test(decoded)) return false;
    try {
      const target = new URL(decoded, origin);
      const path = target.pathname.replace(/\/+$/, "").toLowerCase();
      if (target.origin !== origin || path === "/login" || path === "/register") return false;
      const next = decodeURIComponent(decoded);
      if (next === decoded) return true;
      decoded = next;
    } catch {
      return false;
    }
  }
  return false;
}

export function getSafeRedirect(value: unknown): string {
  return isSafeRedirect(value) ? value : "/";
}
