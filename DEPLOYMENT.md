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

Copy `client/.env.example` to `client/.env.local` and `server/.env.example` to
`server/.env` when configuring local environment variables. Both examples leave
Supabase values blank, which keeps guest play available. For authenticated
connections, set the same project URL and publishable (or legacy anon) key in
both files using `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY` on the client and `SUPABASE_URL` /
`SUPABASE_PUBLISHABLE_KEY` on the server. The server loads its `.env` for the
`start` and `dev` scripts; Vite loads the client `.env.local` automatically.
Only the public publishable/anon key is needed. Never put a Supabase secret key,
service-role key, or database password in a `VITE_` variable or frontend file.

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
session, preserving guest play. A partial Supabase client configuration prevents
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

Phase 1 adds the authentication foundation only; it does not add a login UI or
configure an authentication provider. Before enabling accounts, create/configure
the Supabase project, provide its URL and public key to both deployments, and
integrate a supported sign-in flow in a later phase. Real Supabase token
verification remains a deployment/manual check; automated tests mock Supabase
responses and do not require project credentials.
