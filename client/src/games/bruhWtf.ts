export interface BruhWtfPublicState {
  phase: "answer-submission" | "voting" | "waiting-for-results" | "results";
  currentRound: number;
  totalRounds: number;
  roundId: string;
  prompt: string;
  playerCount: number;
  submissionCount?: number;
  submissionProgress?: Array<{ playerId: string; name: string; submitted: boolean }>;
  options?: Array<{ id: string; completion: string; isOwnAnswer: boolean }>;
  voteCount?: number;
  voteProgress?: Array<{ playerId: string; name: string; voted: boolean }>;
  continueReadyCount?: number;
  continuePlayerCount?: number;
  viewerReadyToContinue?: boolean;
  continueProgress?: Array<{ playerId: string; name: string; ready: boolean }>;
  results?: {
    prompt: string;
    answers: Array<{ completion: string; authorId: string; authorName: string; voterNames: string[]; voteCount: number; pointsAwarded: number }>;
    roundScores: Array<{ playerId: string; name: string; pointsEarned: number }>;
    leaderboard: Array<{ playerId: string; name: string; score: number; rank: number }>;
    winners?: Array<{ playerId: string; name: string }>;
  };
}

export interface BruhWtfViewState {
  currentPlayerId: string | null;
  answerDraft: string;
  isSubmitting: boolean;
  submitError: string | null;
  selectedOptionId: string | null;
  hasVoted: boolean;
  isVoting: boolean;
  voteError: string | null;
  isContinuing: boolean;
  continueError: string | null;
  isHost: boolean;
  isReturningToLobby: boolean;
  returnToLobbyError: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBruhWtfPublicState(value: unknown): value is BruhWtfPublicState {
  if (!isRecord(value)) return false;
  if (![
    "answer-submission",
    "voting",
    "waiting-for-results",
    "results",
  ].includes(String(value.phase))) return false;
  if (
    typeof value.currentRound !== "number" ||
    typeof value.totalRounds !== "number" ||
    typeof value.roundId !== "string" ||
    typeof value.prompt !== "string" ||
    typeof value.playerCount !== "number"
  ) return false;
  if (value.phase === "answer-submission") {
    return typeof value.submissionCount === "number" && Array.isArray(value.submissionProgress);
  }
  if (value.phase === "voting" || value.phase === "waiting-for-results") {
    return typeof value.voteCount === "number" && Array.isArray(value.voteProgress);
  }
  return isRecord(value.results) && Array.isArray(value.results.answers) && Array.isArray(value.results.leaderboard);
}

export function updateBruhSubmissionProgress(
  root: ParentNode,
  publicState: unknown,
  currentPlayerId: string | null,
): boolean {
  if (!isBruhWtfPublicState(publicState) || publicState.phase !== "answer-submission") return false;
  const progress = root.querySelector<HTMLElement>(".bruh-submission-progress");
  const list = root.querySelector<HTMLUListElement>(".bruh-submission-player-list");
  const current = publicState.submissionProgress?.find(({ playerId }) => playerId === currentPlayerId);
  if (!progress || !list || !current) return false;
  progress.textContent = `${publicState.submissionCount} of ${publicState.playerCount} answers submitted`;
  list.replaceChildren();
  for (const player of publicState.submissionProgress ?? []) {
    const item = document.createElement("li");
    item.className = player.submitted ? "progress-chip progress-chip-done" : "progress-chip";
    item.textContent = `${player.name} · ${player.submitted ? "Submitted" : "Waiting"}`;
    list.append(item);
  }
  return !current.submitted;
}

export function updateBruhVoteProgress(
  root: ParentNode,
  publicState: unknown,
  currentPlayerId: string | null,
): boolean {
  if (!isBruhWtfPublicState(publicState) || publicState.phase !== "voting") return false;
  const progress = root.querySelector<HTMLElement>(".bruh-vote-progress");
  const current = publicState.voteProgress?.find(({ playerId }) => playerId === currentPlayerId);
  if (!progress || !current) return false;
  progress.textContent = `${publicState.voteCount ?? 0} of ${publicState.playerCount} players voted`;
  return !current.voted;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderBruhWtfGame(
  value: unknown,
  view: BruhWtfViewState,
  onSubmit: (answer: string) => void,
  onDraftChange: (answer: string) => void,
  onSelectVote: (optionId: string) => void,
  onVote: (optionId: string) => void,
  onContinue: () => void,
  onReturnToLobby: () => void,
  gameDisplayName: string,
  isSessionFinished: boolean,
): HTMLElement {
  const screen = element("section", "app-screen question-screen");
  if (!isBruhWtfPublicState(value)) {
    screen.append(element("h1", undefined, "Game starting"));
    return screen;
  }
  const state = value;
  screen.append(
    element("p", "screen-description", gameDisplayName),
    element("h1", undefined, state.phase === "voting" ? "Voting Round" : state.phase === "results" ? "Round results" : "Bruh wtf?"),
    element("p", "round-counter", `Round ${state.currentRound} of ${state.totalRounds}`),
    element("p", "question-text", state.phase === "results" && state.results ? state.results.prompt : state.prompt),
  );

  if (state.phase === "answer-submission") {
    const submitted = state.submissionProgress?.some(({ playerId, submitted: done }) => playerId === view.currentPlayerId && done) === true;
    const progress = element("p", "bruh-submission-progress submission-progress");
    progress.setAttribute("aria-live", "polite");
    const list = element("ul", "bruh-submission-player-list submission-player-list progress-chip-list");
    screen.append(progress, list);
    updateBruhSubmissionProgress(screen, state, view.currentPlayerId);
    if (submitted) {
      screen.append(element("p", "status-message", "Answer submitted. Waiting for the other players."));
    } else {
      screen.append(element("p", "status-message", "Write an answer and submit when you’re ready."));
      const form = element("form", "submission-form");
      const label = element("label", "field-label", "Your answer");
      label.htmlFor = "bruh-answer";
      const input = element("input", "text-input");
      input.id = "bruh-answer";
      input.name = "answer";
      input.type = "text";
      input.maxLength = 160;
      input.required = true;
      input.autocomplete = "off";
      input.value = view.answerDraft;
      input.disabled = view.isSubmitting;
      input.addEventListener("input", () => onDraftChange(input.value));
      const button = element("button", "primary-button", view.isSubmitting ? "Submitting…" : "Submit");
      button.type = "submit";
      button.disabled = view.isSubmitting;
      form.append(label, input, button);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        onSubmit(input.value);
      });
      screen.append(form);
      if (view.submitError) screen.append(element("p", "error-message", view.submitError));
    }
  } else if (state.phase === "voting") {
    const viewerVoted = view.hasVoted || state.voteProgress?.some(({ playerId, voted }) => playerId === view.currentPlayerId && voted) === true;
    screen.append(element("p", "screen-description", "Answers are anonymous. Choose another player’s answer."));
    const form = element("form", "vote-form");
    let voteButton: HTMLButtonElement | null = null;
    let selectedOptionId = view.selectedOptionId;
    for (const option of state.options ?? []) {
      const label = element("label", "vote-option");
      const input = element("input");
      input.type = "radio";
      input.name = "bruh-vote";
      input.value = option.id;
      input.checked = view.selectedOptionId === option.id;
      input.disabled = view.isVoting || viewerVoted;
      if (option.isOwnAnswer) {
        input.setAttribute("aria-disabled", "true");
        input.tabIndex = -1;
        input.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        input.addEventListener("keydown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      } else {
        input.addEventListener("change", () => {
          selectedOptionId = option.id;
          onSelectVote(option.id);
          if (voteButton) voteButton.disabled = view.isVoting || viewerVoted;
        });
      }
      label.append(input, element("span", undefined, option.completion));
      form.append(label);
    }
    voteButton = element("button", "primary-button", viewerVoted ? "Vote submitted" : view.isVoting ? "Submitting…" : "Submit");
    voteButton.type = "submit";
    voteButton.disabled = view.isVoting || viewerVoted || !view.selectedOptionId;
    form.append(voteButton);
    form.addEventListener("submit", (event) => { event.preventDefault(); if (selectedOptionId) onVote(selectedOptionId); });
    screen.append(form);
    const progress = element("p", "vote-progress bruh-vote-progress", `${state.voteCount ?? 0} of ${state.playerCount} players voted`);
    screen.append(progress);
    if (view.voteError) {
      const error = element("p", "error-message", view.voteError);
      error.setAttribute("role", "alert");
      screen.append(error);
    }
  } else if (state.phase === "waiting-for-results") {
    screen.append(element("p", "status-message", "All votes are in. Preparing results…"));
    screen.append(element("p", "vote-progress", `${state.voteCount ?? 0} of ${state.playerCount} players voted`));
  } else if (state.results) {
    const results = state.results;
    if (results.winners) {
      screen.append(element("h2", undefined, results.winners.length === 1 ? `Winner: ${results.winners[0].name}` : `Tied winners: ${results.winners.map(({ name }) => name).join(", ")}`));
    }
    const answers = element("ul", "revealed-options");
    for (const answer of results.answers) {
      const item = element("li", "bruh-result-answer");
      item.append(
        element("p", undefined, answer.completion),
        element("p", "screen-description", `By ${answer.authorName} · ${answer.voteCount} vote${answer.voteCount === 1 ? "" : "s"} · +${answer.pointsAwarded} points`),
        element("p", "screen-description", answer.voterNames.length ? `Voted by: ${answer.voterNames.join(", ")}` : "No votes"),
      );
      answers.append(item);
    }
    screen.append(element("h2", undefined, "Answers"), answers, element("h2", undefined, "Round points"));
    for (const player of results.roundScores) screen.append(element("p", "status-message", `${player.name}: +${player.pointsEarned}`));
    screen.append(element("h2", undefined, "Leaderboard"));
    for (const player of results.leaderboard) screen.append(element("p", "status-message", `${player.rank}. ${player.name} — ${player.score}`));
    if (!results.winners) {
      const continueButton = element("button", "primary-button", view.isContinuing ? "Waiting…" : view.continueError ?? (state.continueReadyCount ? "Ready to continue" : "Continue"));
      continueButton.disabled = view.isContinuing || state.viewerReadyToContinue === true;
      continueButton.addEventListener("click", onContinue);
      screen.append(continueButton, element("p", "continue-progress", `${state.continueReadyCount ?? 0} of ${state.continuePlayerCount ?? state.playerCount} players ready`));
      for (const player of state.continueProgress ?? []) screen.append(element("p", "status-message", `${player.name}: ${player.ready ? "Ready" : "Waiting"}`));
    }
    if (isSessionFinished && view.isHost) {
      const returnButton = element("button", "secondary-button", view.isReturningToLobby ? "Returning…" : "Return to Lobby");
      returnButton.disabled = view.isReturningToLobby;
      returnButton.addEventListener("click", onReturnToLobby);
      screen.append(returnButton);
      if (view.returnToLobbyError) screen.append(element("p", "error-message", view.returnToLobbyError));
    }
  }
  return screen;
}
