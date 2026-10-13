# Authentication and RBAC

The current `medpm_session` cookie uses the existing signed format with a user ID and expiry. The database-backed session credential planned for Phase 2a will carry a session ID, user ID, per-session secret, and expiry in a signed cookie. The session ID is the `Session.id` primary key; there is no separate session ID column.

The cookie is signed, not encrypted: a person holding it can decode and read the user ID. That ID is an internal account identifier and contains no PHI. The security boundary is signature verification plus an HttpOnly cookie, SameSite=Lax, Secure in production, and HTTPS in production; confidentiality of the cookie payload is not part of that boundary. `SESSION_SECRET` must contain at least 32 bytes. The existing credential verifier remains unchanged until the later session-authentication switch. Cookies expire after eight hours.

API handlers call `getCurrentUser` and `requireRole`; role values supplied by clients are never trusted. `requireRole` returns 401 for a missing session and 403 for a logged-in user without the required role. Keep these checks before parsing or returning protected data.

Roles: ADMIN, PM, MEMBER, QA.

Login policy for Phase 2a: only wrong-password attempts on ACTIVE accounts count. The fifth failed attempt writes a 15-minute lock immediately while still returning the same generic credentials error. Attempts during an active lock are audited but do not increment the counter or extend the lock. When a later login request observes an expired lock, it explicitly clears the stale count before processing the new attempt. Failed-login audit uses the matched account ID when the email exists and the system user ID otherwise; every event carries the masked `targetEmail`.

During the cookie cutover, `getCurrentUser` will accept both the legacy signed cookie and the database-backed signed credential. The login API and this compatibility change must ship together. Legacy cookies remain valid only until their original expiry (at most eight hours); E2E fixtures will migrate to obtaining cookies through the login API.

`POST /api/auth/register` accepts `name`, `email`, `password`, and optional `inviteCode`. Passwords must contain at least 8 characters, including a letter and a number; bcrypt additionally rejects values over 72 UTF-8 bytes. An omitted invite code creates a PENDING account, while a configured matching `REGISTRATION_INVITE_CODE` creates an ACTIVE account. A supplied non-matching code is rejected. Registration does not create a session. Success returns HTTP 201 with `注册成功，请登录` (ACTIVE) or `注册成功，等待管理员激活` (PENDING). Invalid input returns HTTP 400, an invalid invite returns HTTP 400, and duplicate email returns the generic HTTP 409 response `无法完成注册`.
