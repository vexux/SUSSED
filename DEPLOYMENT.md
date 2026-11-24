# Deployment

SUSSED! can be hosted as a Vercel static frontend and a Render Node.js web
service. This guide configures the repository for those providers; it does not
deploy the application.

## Local development

Install dependencies from the repository root:

```sh
npm ci
npm --prefix client ci
npm --prefix server ci
```

Start the Vite client and Node.js server together with `npm run dev`. The client
uses `http://localhost:3000` for the server when `VITE_SERVER_URL` is not set in
development. Vite normally serves the client at `http://localhost:5173`; if
that port is occupied, Vite selects another available port. Localhost origins
are allowed by the development server configuration.

Local files have been initialized from the examples:

- `client/.env.local` is loaded by Vite. Keep `VITE_SERVER_URL=http://localhost:3000`
  for the local backend. `VITE_AUTH_ENABLED` controls client authentication and
  defaults to `false`; while disabled, Firebase is not initialized and guest
  play needs no Firebase or Supabase configuration. To enable account features,
  set `VITE_AUTH_ENABLED=true` and fill in the Firebase web config values:
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and any optional config
  values you use (`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`).
  Optionally set `VITE_AUTH_REDIRECT_URL=http://localhost:5173/`; if unset, the
  current browser origin is used.
- `server/.env` is loaded by the server's `start` and `dev` scripts.
  `AUTH_ENABLED` controls server verification and account/social handlers and
  defaults to `false`; while disabled, Firebase and Supabase settings are not
  required. To enable account features, set `AUTH_ENABLED=true` and configure
  Firebase verification. Fill in `FIREBASE_PROJECT_ID`. For local Admin SDK auth,
  either rely on Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`
  or a local gcloud login) or provide `FIREBASE_CLIENT_EMAIL` and
  `FIREBASE_PRIVATE_KEY`. `PORT=3000`, `NODE_ENV=development`, and the blank
  `CLIENT_ORIGIN` are suitable for local development. Profiles additionally
  require server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; leave both
  unset to keep profile persistence disabled while guest and room play remain
  available.

The client and server flags are independent. Keep both false for guest-only
mode, or set both true to reactivate account features. Boolean values must be
`true` or `false`. A mismatch is reported by the client when it can connect;
authenticated handshakes are rejected if server authentication is disabled.

To find the values in the Firebase console, open the project and copy the web
config values from **Project settings > General > Your apps**. Use the same
project ID on the server. Do not paste any private key or service-account JSON
into a frontend variable; keep private credentials server-side only.

These local files are ignored by Git. The `.env.example` files contain blank
values and remain tracked. The Firebase web config is designed for public
clients; never place a Firebase service-account private key, database password,
or other privileged secret in the client or any `VITE_` variable.

## Persistent account profiles

The profiles table stores minimal account metadata independently from Firebase
Auth and multiplayer sessions. `profiles.id` is `TEXT` and stores the verified
Firebase UID exactly; it is not a UUID, Socket.IO ID, or room player ID.
`display_name` is editable metadata (defaulting to `Player`), with `created_at`
and trigger-maintained `updated_at` timestamps. The initial migration permits
1–32 characters; the Phase 2 migration below tightens editable display names to
2–20 trimmed characters. No credentials or auth tokens are stored. Guests do not
receive profile rows.

The non-destructive migration is
[`supabase/migrations/202610260001_profiles.sql`](./supabase/migrations/202610260001_profiles.sql).
Review it and apply it manually in the intended Supabase project's SQL Editor,
or use your established migration workflow. It creates the table only if
missing, enables RLS without client-facing policies, revokes `anon` and
`authenticated` table access, and grants access to `service_role`. Do not apply
it automatically to a live database without reviewing the target and taking
your normal backup/safety steps.

To enable profile operations on the server, set `SUPABASE_URL` to the project's
Project URL and `SUPABASE_SERVICE_ROLE_KEY` to its server-side service-role
secret. Find the URL in **Supabase Project Settings > API** and the service-role
key in **Project Settings > API Keys**. These values are used only by the Node
server. Never add the service-role key to a `VITE_` variable, the client env
file, or browser code. If either setting is absent, profile operations return a
controlled unavailable response; authentication, guests, and room play remain
available.

The server verifies each Firebase ID token before profile operations and obtains
the UID only from verified socket metadata. Profile actions run only when a
user opens the account screens; they are not in the room/game critical path.
The server-issued stable player ID is the multiplayer identity; `socket.id` is
transport-only. An unexpected disconnect reserves the room seat and match
record for 90 seconds, but immediately removes that player from the current
round's action quorum. Completed answers and votes, score, and history remain
intact. A recovery within the grace period restores the same identity as a
spectator until the next question; on the final round, the player remains a
spectator through final results. The server rejects spectator actions. At
expiry, permanent departure cleanup runs exactly once; explicit leave and kick
remain immediate and do not enter the spectator flow. Guest identities are
separate from account profiles.

On a same-tab page refresh, the browser reuses the guest recovery credential
from `sessionStorage` and asks the server to restore the current room and view.
The server returns current authoritative lobby/game state; the client buffers
live room events during that handshake so newer updates are not lost. Lobby,
active-game, and still-open results views can be restored while their state
remains in server memory. A temporary restoration failure offers a retry and
does not discard the credential. This is not cross-tab recovery and cannot
restore rooms or games after a server restart or redeployment.

### Handles, friends, and account screens

Phase 2 extends the existing profile table with a unique handle and handle
change timestamp, and adds persistent friend requests/friendships. Review
[`supabase/migrations/202610260002_profiles_handles_friends.sql`](./supabase/migrations/202610260002_profiles_handles_friends.sql)
and apply it manually after the original profiles migration through the
intended Supabase project's SQL Editor or your established migration workflow.
It is forward-only and does not drop or recreate existing profile data. It has
not been applied automatically; verify the target project, take the normal
backup/safety steps, and review its SQL before applying, especially in
production.

Handles are unique lowercase alphanumeric names of 3–20 characters. The `@`
is presentation-only; a new profile gets a generated handle, and existing
profiles without one are assigned one safely by the database helper. Handle
changes are enforced server-side and can occur once per seven-day period.
Display names are trimmed, 2–20 characters, and can be changed without that
cooldown.

Profile and social Socket.IO operations require a verified Firebase ID token.
The server derives the account key from `socket.data.accountId`; clients never
choose the account ID. Profile, handle, and friendship queries use the
server-only Supabase service-role credential. RLS remains enabled with no
`anon` or `authenticated` table access. Public handle/name search and public
profiles return only display names and handles, never Firebase UIDs, emails,
or auth data. Guests cannot use these operations and are not linked to accounts.
Database errors are reported as controlled social/profile errors; they do not
prevent guests or signed-in users from using rooms and games.

The Friends screen supports public player search, incoming/outgoing requests,
and the friends list. The Achievements screen currently says “No achievements
yet”; Phase 2 does not generate achievement data or introduce tracking.

## Local Firebase Authentication Emulator

The Auth Emulator runs as a demo project and does not contact or modify the
production Firebase project. Emulator mode is opt-in, requires a Vite
development server and `NODE_ENV=development`, and refuses to start with the
production project ID. The server sets the Admin SDK's
`FIREBASE_AUTH_EMULATOR_HOST` internally only after those checks pass. Do not set
that Admin SDK variable yourself.

Install Firebase CLI globally if it is not already installed:

```sh
npm install --global firebase-tools
firebase --version
```

No Firebase login or project creation is needed for the demo project. From the
repository root, start the Auth Emulator and its UI:

```sh
firebase emulators:start --project demo-sussed-167f0 --only auth
```

The emulator listens on `http://127.0.0.1:9099`; its UI is at
`http://127.0.0.1:4000`. Keep this terminal running.

In `client/.env.local`, set `VITE_FIREBASE_PROJECT_ID=demo-sussed-167f0` and
`VITE_FIREBASE_AUTH_EMULATOR_ENABLED=true`. Keep the other Firebase web config
fields present so Firebase can initialize; the emulator intercepts Auth
requests. In `server/.env`, set `NODE_ENV=development`,
`FIREBASE_PROJECT_ID=demo-sussed-167f0`, and
`FIREBASE_AUTH_EMULATOR_ENABLED=true`. Emulator mode does not require a service
account. Leave the emulator flag false or unset for normal Firebase project
authentication. Never set the emulator flag in Vercel, Render, or other
production environments.

To test profile persistence while using the Auth Emulator, also configure
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `server/.env` and apply the
profiles migration to a non-production Supabase project. Emulator users are
isolated test identities; their Firebase UIDs are stored as text profile IDs.
Do not use a production service-role key for emulator tests.

Start the server and client in separate terminals from the repository root:

```sh
npm run dev:server
npm run dev:client
```

Restart both after editing environment files. Register a test user using the
SUSSED! account panel; that creates an emulator-only user and requests its
verification email. The Auth Emulator writes the generated verification action
link to the emulator terminal output. Open that local action link in a browser
to verify the test account. The Emulator UI at `http://127.0.0.1:4000` lets you
inspect and manage emulator users; users can also be added there for testing.
One-time action links are sensitive: use them only locally and do not share
them. Password recovery links are emitted to the emulator output in the same
way.

To stop the emulator, press Ctrl+C in its terminal. After testing, set both
emulator flags to `false` (or remove them) and restore the real
`FIREBASE_PROJECT_ID` and client project ID before using normal Firebase Auth.
The production build rejects the client emulator flag, and the server rejects
emulator mode unless it is explicitly enabled with `NODE_ENV=development` and
the demo project ID.

After changing either file, restart the affected process so it reloads its
environment. Stop the combined development command with Ctrl+C, then run
`npm run dev` again from the repository root. Or run the server and client in
separate terminals with `npm run dev:server` and `npm run dev:client`. Vite
loads `.env.local` at startup; the server's `start` and `dev` scripts load
`server/.env`.

Run relevant checks from the repository root:

```sh
npm --prefix server test
npm --prefix client test
npm --prefix client run typecheck
npm run build
```

## Firebase Auth setup

This section applies only when both `VITE_AUTH_ENABLED=true` and
`AUTH_ENABLED=true`. `VITE_AUTH_ENABLED=false` disables authentication and
account UI in the client; `AUTH_ENABLED=false` disables server verification and
account/social handlers. Keep both false for guest-only play; the guest room and
game flow remains available.

Configure email/password in the Firebase console under **Authentication > Sign-in method > Email/Password**.
Keep email verification enabled if accounts should verify their addresses.
Use Firebase's built-in email verification and password-reset flow. Do not add a
custom SMTP provider or Resend credentials for the standard email auth flow.

Add the local app origin (for example `http://localhost:5173/`) and any Preview
or production callback origins to the authorized redirect URLs used by your
configured auth providers. A configured `VITE_AUTH_REDIRECT_URL` is passed to
email verification and password recovery flows; if blank, the page's current
origin is used.

To enable Google sign-in:

1. In Google Cloud Console, configure the OAuth consent screen and create a
   **Web application** OAuth client.
2. Add the primary app redirect/callback URL used by your Firebase Auth sign-in
   flow to the Google OAuth authorized redirect URIs.
3. In Firebase, open **Authentication > Sign-in method > Google** and enable the
   provider, then add the Google OAuth client ID and secret to the Firebase
   project configuration.
4. Keep the app's redirect URL (for local development, `http://localhost:5173/`)
   in the allowed origins and callback URLs for the configured Firebase app.

No extra Google OAuth environment variable is required by this client. If the
provider is not enabled, the UI reports a configuration error rather than
showing a false successful sign-in.

## Local guest restoration smoke test

Run the guest flow with `AUTH_ENABLED=false` and `VITE_AUTH_ENABLED=false`, then
start the server and client in separate terminals. Use separate browser
profiles for the players; guest recovery credentials are tab-scoped.

1. **Lobby refresh:** create a room in one profile and join from a second.
   Refresh the host tab. It should return to the same room with the same host
   and player count, and the other player should see the host connected again.
2. **Active game refresh:** start Fact-or-Cap, submit an answer and/or vote,
   then refresh that player's tab. The same game and phase should return with
   that player's own submission/vote state preserved. Repeat with Bruh WTF
   using at least three players.
3. **Disconnect grace:** disconnect unexpectedly during an active round and
   confirm connected players can finish without waiting for the disconnected
   player. Reconnect before 90 seconds and verify the same room and identity
   return as a spectator for that round; confirm actions are rejected and the
   player can act again at the next question. Repeat during the final round and
   confirm final results remain visible without reactivation. Automated tests
   use a fake clock for expiry checks; they do not wait 90 real seconds. A
   manual expiry check must allow the complete server-controlled 90-second
   interval to elapse. Explicit leave and kick should remove the player
   immediately.
4. **Departure:** leave normally and repeat with a host kick. Refresh/reconnect
   the departing player's tab; it should not restore the old room, but the
   stable guest identity should still be able to join a different room.

These checks do not imply cross-tab identity sharing or recovery after a server
restart/redeployment. The browser workflow is a manual smoke test; the
automated socket integration suite covers the corresponding deterministic
server lifecycle cases.

## Local account-flow smoke test

After filling the client and server Firebase configuration values, start the
server and client from separate repository-root terminals:

```sh
npm run dev:server
npm run dev:client
```

Restart both processes after changing environment values. In the browser:

1. Create a test account with an inbox you can access. With confirmation
   enabled, the app should show a verification-required message; open the
   verification email and follow its link back to the local app. The resend
   button has a 60-second cooldown.
2. Sign in and verify the account email is shown on the home screen. The
   Socket.IO handshake fetches the current session token; the server verifies
   it with Firebase Auth before setting `socket.data.accountId`. Never inspect,
   paste, or log the token. For server-side confirmation, inspect only the
   socket's `data.accountId` using a local debugger.
3. Create/join a room as a guest and verify room/game behavior remains
   available. An unexpected disconnect reserves the in-memory room seat and
   match record for 90 seconds, while the match continues for connected
   players. Reconnecting with the same guest recovery credential returns the
   player as a spectator for the current round; confirm their actions are
   rejected and they rejoin at the next question. On the final round, they
   remain a spectator and can view the results. Explicit leave and host kick
   remain immediate; server restart clears rooms and grace timers. Refresh the
   same browser tab during the grace period to verify it restores the current
   room or view. Also verify a completed-results viewer refreshes back to
   results after the host returns to the lobby. A guest with no room should
   return to room entry, and can still use the same guest identity to join a
   room. Restoration does not work across tabs or server restarts.
4. Test **Forgot password**, open the recovery message, submit a new password,
   then sign in with it. Try an expired link to confirm the app offers a new
   recovery email. Try Google after completing the dashboard setup.

The automated client auth tests mock Firebase Auth methods; server token tests
also use mocked responses. They do not verify real email delivery, Google OAuth
credentials, provider redirect allowlists, or a live test-user token. Do not
claim those integrations work until this smoke test succeeds against the
configured project.

Run the server tests with `npm --prefix server test`, client tests with
`npm --prefix client test`, type-check with `npm --prefix client run typecheck`,
and build the production client with `npm run build`. The build creates
`client/dist`; serve that static output through the configured frontend host
and run the backend with `npm --prefix server start`.

## Vercel frontend

Create a Vercel project for this repository with:

- **Project root directory:** `client`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variable:** `VITE_SERVER_URL`, set to the public URL of the
  Render Socket.IO service (for example, `https://your-service.onrender.com`).
- **Optional environment variable:** `VITE_PUBLIC_APP_URL`, set to the public
  frontend origin used in copied invitation links (for example,
  `https://your-project.vercel.app`). Set an origin only, without a path or
  query. If omitted, invitations use the current browser origin, which works
  for production and Preview deployments without embedding a development URL.
- **Optional environment variables:** `VITE_FIREBASE_API_KEY`,
  `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and
  `VITE_FIREBASE_APP_ID`, set to the Firebase web configuration for
  authenticated socket handshakes. Leave them unset for guest-only operation.
- **Optional environment variable:** `VITE_AUTH_REDIRECT_URL`, set to an
  absolute app callback URL that is allowlisted for the Firebase app (for example,
  `https://your-project.vercel.app/`). If unset, the current page origin is
  used.

Set the variable for both Preview and Production environments as needed. Vite
embeds it at build time, so trigger a new deployment after changing it.
Set `VITE_PUBLIC_APP_URL` separately per deployment environment when links
should point to a canonical frontend domain rather than the domain currently
open in the browser.

`VITE_` variables are embedded in the client build and visible to every
visitor. Use them only for public configuration such as service URLs; never
put secrets in them. Set `VITE_SERVER_URL` to the backend's HTTPS origin in
production. Socket.IO then uses HTTPS/WSS for its cross-origin connection.
If a production build is missing `VITE_SERVER_URL`, the client reports the
configuration error instead of attempting to connect to localhost. Rebuild
after setting the variable.

The client obtains the current Firebase ID token when Socket.IO connects and
sends it in the handshake. It sends no token if there is no eligible signed-in
user, preserving guest play. Firebase refreshes tokens automatically; a new
handshake always reads the latest token. A change between signed-in and
guest/account identities disconnects the old socket before a fresh connection.
A room participant's identity remains separate from the verified account UID,
and the same 90-second disconnect grace applies to transient socket
replacement.

The client currently uses the root path and invitation query strings such as
`/?code=ABCD`; it does not define path-based client routes, so no SPA rewrite is
needed for the current UI. If path-based routes are added later, configure the
frontend host to serve `index.html` for those routes.

## Render backend

Create a Render **Web Service** for this repository with:

- **Root directory:** `server`
- **Build/install command:** `npm ci`
- **Start command:** `npm start`
- **Health check path:** `/healthz`

Configure these environment variables in Render:

- `NODE_ENV=production`
- `AUTH_ENABLED=false` for guest-only mode; set to `true` only when intentionally
  re-enabling Firebase authentication and account/social handlers.
- `CLIENT_ORIGIN=https://your-project.vercel.app`
- `FIREBASE_PROJECT_ID=sussed-167f0`
- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` (optional when
  running with default application credentials on supported hosts)
- `SUPABASE_URL=https://your-project.supabase.co` (required to enable profiles)
- `SUPABASE_SERVICE_ROLE_KEY=<server-only service-role secret>` (required to
  enable profiles)
- Do not set `FIREBASE_AUTH_EMULATOR_ENABLED` or
  `FIREBASE_AUTH_EMULATOR_HOST` in production.

`CLIENT_ORIGIN` must be the exact frontend origin, including the scheme and
without a path or trailing slash. Multiple explicit origins can be
comma-separated, for example a production Vercel domain and a custom domain.
Do not use `*`. Render supplies `PORT` to the service; the server uses that
value and defaults to port `3000` for local development.

When `AUTH_ENABLED=false`, the server skips Firebase Admin verifier and Supabase
repository initialization and does not register profile/social or in-app
invitation handlers. Guest connections still work with no Firebase or Supabase
credentials. When `AUTH_ENABLED=true`, server-side Socket.IO auth verifies each
supplied ID token with Firebase Admin,
then records the verified UID in `socket.data.accountId`. It does not trust a
client-provided account ID. A token that is invalid, expired, or unverifiable is
rejected, not treated as a guest. Keep any service-account credentials on the
server only and do not expose them in frontend config or Vite variables.

Set `VITE_AUTH_ENABLED` independently in the Vercel build environment. Set both
client and server flags to `true` to expose account features. A client/server
flag mismatch is reported when the Socket.IO connection is available; an
authenticated client cannot connect with a token while server authentication
is disabled.

The Supabase URL and service-role key support persistent profiles, friendships,
notifications and game invitations and must remain server-side. See the
[notification and invitation migration](./supabase/migrations/202610260003_notifications_game_invitations.sql).
These credentials are optional for guest and room
play. See [Persistent account profiles](#persistent-account-profiles) for the
schema and safe manual migration steps.

Verify the service by opening `https://your-service.onrender.com/healthz`. A
healthy instance responds with HTTP 200 and `{"status":"ok"}`.

Render's free tier may suspend an idle service, causing cold-start delays on its
next request. Rooms and game sessions are held only in server memory; they are
lost whenever the server restarts or is redeployed.

## Room codes

New rooms receive an uppercase, four-letter code selected from a curated list
of memorable words. Players may enter the code in lowercase; lookup normalizes
it to uppercase. Codes identify rooms and are not authentication credentials.
The word list is finite, so room creation fails explicitly if every available
code is in use. Room state remains in memory and is lost when the server
restarts.

## Git and deployment workflow

- `main` is the production branch.
- `dev` is the ongoing development branch.
- GitHub Actions runs the test, type-check, build, and syntax checks on pushes
  and pull requests.
- Configure Vercel to create Preview deployments for feature branches and
  Production deployments from `main`.
- Integrate changes into `dev`, then promote reviewed changes from `dev` to
  `main` for production.

No deployment occurs from this repository configuration alone. Provider
projects, branch settings, and environment variables must be configured
separately.

Before release, verify from the deployed frontend origin that the Socket.IO
connection reaches the configured HTTPS backend, public-room discovery and
cross-origin joining work, visibility changes update the listing, and copied
invitation links open that frontend with the room code prefilled. Confirm the
Render health check returns HTTP 200 and that `CLIENT_ORIGIN` lists the exact
production frontend origin (plus only the previews or custom domains that
should be allowed). Exercise these checks against the provider deployment;
local tests cannot verify provider environment variables, DNS, TLS, or CORS
configuration.

Phase 2 adds email/password, recovery, and Google sign-in UI on top of the
server token verification. Firebase project settings and Google Cloud credentials
remain operator-configured as described above.
Automated tests mock Firebase interactions; real email delivery, Google OAuth,
and live project token verification require the local account-flow smoke test.
For profile persistence, use the Supabase configuration above. Multiplayer
recovery relies on the running backend's in-memory room state.
