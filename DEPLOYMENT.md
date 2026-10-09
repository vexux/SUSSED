# Deployment

SUSSED! can be hosted as a Vercel static frontend and a Render Node.js web
service. This guide configures the repository for those providers; it does not
deploy the application.

## Vercel frontend

Create a Vercel project for this repository with:

- **Project root directory:** `client`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variable:** `VITE_SERVER_URL`, set to the public URL of the
  Render Socket.IO service (for example, `https://your-service.onrender.com`).

Set the variable for both Preview and Production environments as needed. Vite
embeds it at build time, so trigger a new deployment after changing it.

## Render backend

Create a Render **Web Service** for this repository with:

- **Root directory:** `server`
- **Build/install command:** `npm ci`
- **Start command:** `npm start`
- **Health check path:** `/healthz`

Configure these environment variables in Render:

- `NODE_ENV=production`
- `CLIENT_ORIGIN=https://your-project.vercel.app`

`CLIENT_ORIGIN` must be the exact frontend origin, including the scheme and
without a path or trailing slash. Multiple explicit origins can be
comma-separated, for example a production Vercel domain and a custom domain.
Do not use `*`. Render supplies `PORT` to the service; the server uses that
value and defaults to port `3000` for local development.

Verify the service by opening `https://your-service.onrender.com/healthz`. A
healthy instance responds with HTTP 200 and `{"status":"ok"}`.

Render's free tier may suspend an idle service, causing cold-start delays on its
next request. Rooms and game sessions are held only in server memory; they are
lost whenever the server restarts or is redeployed.

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
