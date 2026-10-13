# Authentication and RBAC

The current `medpm_session` cookie uses the existing signed format with a user ID and expiry. The database-backed session credential planned for Phase 2a will carry a session ID, user ID, per-session secret, and expiry in a signed cookie. The session ID is the `Session.id` primary key; there is no separate session ID column.

The cookie is signed, not encrypted: a person holding it can decode and read the user ID. That ID is an internal account identifier and contains no PHI. The security boundary is signature verification plus an HttpOnly cookie, SameSite=Lax, Secure in production, and HTTPS in production; confidentiality of the cookie payload is not part of that boundary. `SESSION_SECRET` must contain at least 32 bytes. The existing credential verifier remains unchanged until the later session-authentication switch. Cookies expire after eight hours.

API handlers call `getCurrentUser` and `requireRole`; role values supplied by clients are never trusted. `requireRole` returns 401 for a missing session and 403 for a logged-in user without the required role. Keep these checks before parsing or returning protected data.

Roles: ADMIN, PM, MEMBER, QA.
