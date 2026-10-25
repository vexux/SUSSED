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
  for the local backend. To enable Supabase on the client, fill in
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Optionally set
  `VITE_AUTH_REDIRECT_URL=http://localhost:5173/`; if unset, the current browser
  origin is used.
- `server/.env` is loaded by the server's `start` and `dev` scripts. To enable
  token verification, fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
  `PORT=3000`, `NODE_ENV=development`, and the blank `CLIENT_ORIGIN` are suitable
  for local development.

To find the values in the Supabase dashboard, open the project and copy its
**Project URL** from **Project Settings > API**. Copy its **Publishable key**
from **Project Settings > API Keys** (a legacy `anon` public key is also
supported). Paste the same Project URL and public key into the client and server
variables listed above. Variable names are intentionally different on the client
(`VITE_` prefix) and server, but both must point to the same project.

These local files are ignored by Git. The `.env.example` files contain blank
values and remain tracked. The publishable/anon key is designed for public
clients; never use a Supabase secret key, service-role key, or database password
in the client or any `VITE_` variable. No privileged key is needed by this
server verifier.

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

## Supabase Auth setup

Configure email/password in **Authentication > Sign In / Providers > Email**.
Keep email confirmation enabled if accounts should verify their addresses.
Configure the email sender under **Authentication > SMTP Settings** if using a
custom sender such as Resend: verify a sender domain in Resend, create an SMTP
credential there, and enter the SMTP host (`smtp.resend.com`), supported TLS
port, username (`resend`), password/API key, and verified sender address in
Supabase. SMTP credentials belong only in Supabase's dashboard, never in this
repository, a client environment variable, or chat.
Review the confirmation, recovery, and magic-link templates under
**Authentication > Email Templates** and ensure their links return to the
configured app origin.

Keep the Supabase **Site URL** set to the canonical frontend URL you use as the
default (or localhost for a local-only project), and add
`http://localhost:5173/` to the allowed **Redirect URLs** under
**Authentication > URL Configuration**. If Vite chooses another port, use that
origin instead and update `VITE_AUTH_REDIRECT_URL`. A configured
`VITE_AUTH_REDIRECT_URL` is passed to email verification, password recovery, and
Google OAuth; if blank, the page's current origin is used. Add each local,
Preview, and production callback origin to Supabase's allowlist.

To enable Google sign-in:

1. In Google Cloud Console, configure the OAuth consent screen and create a
   **Web application** OAuth client.
2. Add the Supabase Auth callback URL shown in the Supabase Google provider
   settings (normally `https://<project-ref>.supabase.co/auth/v1/callback`) as
   an authorized redirect URI in Google Cloud.
3. In Supabase, open **Authentication > Sign In / Providers > Google**, enable
   the provider, and enter the Google OAuth client ID and client secret there.
   Do not add either value to Vite variables or frontend code.
4. Add the app's redirect URL (for local development,
   `http://localhost:5173/`) to Supabase **Authentication > URL Configuration**.

No extra Google OAuth environment variable is required by this client. If the
provider is not enabled, the UI reports a configuration error rather than
showing a false successful sign-in.

## Local account-flow smoke test

After filling both the client and server Supabase URL/publishable-key pairs,
start the server and client from separate repository-root terminals:

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
   it with Supabase Auth before setting `socket.data.accountId`. Never inspect,
   paste, or log the token. For server-side confirmation, inspect only the
   socket's `data.accountId` using a local debugger.
3. Create/join a room as a guest and verify room/game behavior remains
   available. Signing in, switching accounts, or signing out disconnects and
   lets server disconnect cleanup run before reconnecting; the current room
   session ends. Persistent reconnect is not part of this phase.
4. Test **Forgot password**, open the recovery message, submit a new password,
   then sign in with it. Try an expired link to confirm the app offers a new
   recovery email. Try Google after completing the dashboard setup.

The automated client auth tests mock Supabase methods; server token tests also
use mocked responses. They do not verify real email delivery, Google OAuth
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
- **Optional environment variables:** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, set to the Supabase project URL and its
  public publishable key (or legacy anon key) to enable authenticated socket
  handshakes. Leave both unset for guest-only operation.
- **Optional environment variable:** `VITE_AUTH_REDIRECT_URL`, set to an
  absolute app callback URL that is allowlisted in Supabase (for example,
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
- `SUPABASE_URL=https://your-project.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=<the same public publishable or legacy anon key>`

`CLIENT_ORIGIN` must be the exact frontend origin, including the scheme and
without a path or trailing slash. Multiple explicit origins can be
comma-separated, for example a production Vercel domain and a custom domain.
Do not use `*`. Render supplies `PORT` to the service; the server uses that
value and defaults to port `3000` for local development.

The two Supabase variables are optional together for guest-only service. Set
both to enable authenticated sockets; setting only one prevents server startup.
The server validates every supplied access token by calling Supabase Auth's
`getUser(token)` endpoint and only then records the verified UUID in
`socket.data.accountId`. It does not trust a client-provided account ID. A token
that is invalid, expired, or unverifiable is rejected, not treated as a guest.
Use only the project's public publishable/anon key here; a service-role/secret
key and database password are neither required nor appropriate.

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

Phase 2 adds email/password, recovery, and Google sign-in UI on top of Phase 1's
server token verification. Supabase project settings, SMTP/email delivery, and
Google Cloud credentials remain operator-configured as described above.
Automated tests mock Supabase interactions; real email delivery, Google OAuth,
and live project token verification require the local account-flow smoke test.
Profile storage, account linking, and persistent reconnect are not part of this
phase.
