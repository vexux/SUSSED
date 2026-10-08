import type { AppState } from "./appState";

const viewContent = {
  home: {
    heading: "SUSSED!",
    description: "A multiplayer social deduction game.",
  },
  lobby: {
    heading: "Lobby",
    description: "The lobby screen is ready for future development.",
  },
  game: {
    heading: "Game",
    description: "The game screen is ready for future development.",
  },
} as const;

export function renderApp(root: HTMLElement, state: AppState): void {
  const content = viewContent[state.currentView];
  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <span class="brand">SUSSED!</span>
        <span class="connection-status" data-status="${state.connectionStatus}">
          ${state.connectionStatus}
        </span>
      </header>
      <section class="app-screen" aria-labelledby="screen-heading">
        <h1 id="screen-heading">${content.heading}</h1>
        <p>${content.description}</p>
      </section>
    </main>
  `;
}
