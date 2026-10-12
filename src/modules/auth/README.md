# Authentication and RBAC

Sessions use the signed, HttpOnly `medpm_session` cookie. `SESSION_SECRET` must contain at least 32 bytes; the token only carries a user ID and expiry, and each request loads the current role from MySQL so role changes take effect immediately. The credential verifier is intentionally an upstream integration point: call `setSessionCookie` only after credentials have been verified. The cookie is Secure in production and expires after eight hours.

API handlers call `getCurrentUser` and `requireRole`; role values supplied by clients are never trusted. `requireRole` returns 401 for a missing session and 403 for a logged-in user without the required role. Keep these checks before parsing or returning protected data.

Roles: ADMIN, PM, MEMBER, QA.
