# SUSSED!

SUSSED! is a guest-first multiplayer party game for the browser. Players meet in a room, choose a game and play rounds together. See [Product](docs/PRODUCT.md) for the player experience.

## Run locally

Use Node.js 22 as in CI. From the repository root, install all three packages and start both processes.

```sh
npm ci
npm --prefix client ci
npm --prefix server ci
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173). The Node.js Socket.IO server defaults to port 3000. Guest play works with authentication disabled. For account features, use the [client example](client/.env.example), [server example](server/.env.example) and [deployment guide](DEPLOYMENT.md) to configure Firebase and server-side Supabase access.

## Find the owner of a change

| Task | Start here |
| --- | --- |
| Change a screen or its event wiring | [TypeScript DOM views](client/src/views.ts), [client application](client/src/main.ts) |
| Change joining, readiness or discovery | [Room manager](server/roomManager.js), [room handlers](server/roomHandlers.js), [wire contracts](server/ROOM_PROTOCOL.md) |
| Extend the game library | [Architecture](docs/ARCHITECTURE.md), [game registry](server/gameRegistry.js) |
| Change rules or question content | [Fact or Cap and Anime](server/games/fact-or-cap/README.md), [Bruh wtf?](server/games/bruh-wtf/README.md) |
| Change chat or report review | [Chat manager](server/roomChatManager.js), [moderation](server/moderation.js) |
| Change persistent account data | [Server repository](server/profileRepository.js), [SQL migrations](supabase/migrations) |
| Configure hosting or manually exercise recovery | [Deployment](DEPLOYMENT.md) |
| Understand engineering constraints | [Decisions](docs/DECISIONS.md), [known issues](docs/KNOWN_ISSUES.md), [agent instructions](AGENTS.md) |

## Verify from the repository root

Root `npm test` runs only the server suite. The complete [CI verification sequence](.github/workflows/ci.yml) after installation is:

```sh
npm --prefix server test
npm --prefix client test
npm --prefix server run validate:questions -- fact-or-cap games/fact-or-cap/content/general/general-facts-batch-2026-10.json
npm --prefix server run validate:questions -- fact-or-cap-anime games/fact-or-cap/content/anime/anime-facts-batch-2026-10.json
npm --prefix client run typecheck
npm --prefix client run build
node --check server/config.js
node --check server/server.js
node --check server/roomManager.js
node --check server/roomHandlers.js
node --check server/gameManager.js
node --check server/gameRegistry.js
node --check server/games/fact-or-cap/game.js
node --check server/games/fact-or-cap/questionLibrary.js
node --check server/games/fact-or-cap/socketHandlers.js
node --check server/games/fact-or-cap/questionBank.js
node --check server/games/fact-or-cap/scripts/validate-question-pack.js
node --check server/games/fact-or-cap/scripts/manage-question-batch.js
node --check server/test/config.test.js
node --check server/test/questionLibrary.test.js
node --check server/test/questionBatch.test.js
node --check server/test/roomManager.test.js
node --check server/test/gameManager.test.js
node --check server/test/server.test.js
```
