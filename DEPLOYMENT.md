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
  for the local backend. To enable Firebase on the client, fill in the Firebase
  web config values: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and any optional config
  values you use (`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`).
  Optionally set `VITE_AUTH_REDIRECT_URL=http://localhost:5173/`; if unset, the
  current browser origin is used.
- `server/.env` is loaded by the server's `start` and `dev` scripts. To enable
  token verification, fill in `FIREBASE_PROJECT_ID`. For local Admin SDK auth,
  either rely on Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`
  or a local gcloud login) or provide `FIREBASE_CLIENT_EMAIL` and
  `FIREBASE_PRIVATE_KEY`. `PORT=3000`, `NODE_ENV=development`, and the blank
  `CLIENT_ORIGIN` are suitable for local development.

To find the values in the Firebase console, open the project and copy the web
config values from **Project settings > General > Your apps**. Use the same
project ID on the server. Do not paste any private key or service-account JSON
into a frontend variable; keep private credentials server-side only.

These local files are ignored by Git. The `.env.example` files contain blank
values and remain tracked. The Firebase web config is designed for public
clients; never place a Firebase service-account private key, database password,
or other privileged secret in the client or any `VITE_` variable.

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
   available. Signing in, switching accounts, or signing out disconnects and
   lets server disconnect cleanup run before reconnecting; the current room
   session ends. Persistent reconnect is not part of this phase.
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

The client obtains the current Supabase session when Socket.IO connects and
sends its access token in the handshake. It sends no token if there is no
session, preserving guest play. Supabase refreshes sessions automatically; a
new handshake always reads the latest session. A change between signed-in and
guest/account identities disconnects the old socket so server cleanup runs
before a fresh connection. A partial Supabase client configuration prevents
the connection rather than silently downgrading to guest mode.

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
- `CLIENT_ORIGIN=https://your-project.vercel.app`
- `FIREBASE_PROJECT_ID=your-firebase-project-id`
- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` (optional when
  running with default application credentials on supported hosts)

`CLIENT_ORIGIN` must be the exact frontend origin, including the scheme and
without a path or trailing slash. Multiple explicit origins can be
comma-separated, for example a production Vercel domain and a custom domain.
Do not use `*`. Render supplies `PORT` to the service; the server uses that
value and defaults to port `3000` for local development.

The Firebase project configuration is optional for guest-only service. When set,
server-side Socket.IO auth verifies each supplied ID token with Firebase Admin,
then records the verified UID in `socket.data.accountId`. It does not trust a
client-provided account ID. A token that is invalid, expired, or unverifiable is
rejected, not treated as a guest. Keep any service-account credentials on the
server only and do not expose them in frontend config or Vite variables.

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
Profile storage, account linking, and persistent reconnect are not part of this
phase.
