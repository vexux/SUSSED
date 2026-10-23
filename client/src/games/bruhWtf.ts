import {
  appendContinueReadiness,
  appendGameHeader,
  appendWinnerPresentation,
  createAnswerResultCard,
  createQuestionText,
  createRoundHistorySection,
  createStandingsList,
  createStatusMessage,
  createSubmissionForm,
  createSubmissionProgress,
  createVoteProgress,
  createVotingForm,
  replaceProgressChipList,
} from "../ui/gamePresentation.ts";

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
    activeLeaderboard?: Array<{ playerId: string; name: string; score: number; rank: number }>;
    winners?: Array<{ playerId: string; name: string }>;
    activeWinners?: Array<{ playerId: string; name: string }>;
    roundHistory?: Array<{
      round: number;
      prompt: string;
      answers: Array<{ completion: string; authorId: string; authorName: string; voterNames: string[]; voteCount: number; pointsAwarded: number }>;
      roundScores: Array<{ playerId: string; name: string; pointsEarned: number }>;
      leaderboard: Array<{ playerId: string; name: string; score: number; rank: number }>;
    }>;
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
  isResultsViewer?: boolean;
  isReturningToLobby: boolean;
  returnToLobbyError: string | null;
  historyOpen?: boolean;
  historyPage?: number;
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
  replaceProgressChipList(list, publicState.submissionProgress ?? [], (player) => {
    const status = player.submitted ? "Submitted" : "Waiting";
    return player.playerId === currentPlayerId ? `You · ${status}` : `${player.name} · ${status}`;
  });
  for (const item of Array.from(list.children)) {
    const player = publicState.submissionProgress?.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
    if (player?.submitted) item.classList.add("progress-chip-done");
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
  const list = root.querySelector<HTMLUListElement>(".bruh-vote-player-list");
  const current = publicState.voteProgress?.find(({ playerId }) => playerId === currentPlayerId);
  if (!progress || !current) return false;
  progress.textContent = `${publicState.voteCount ?? 0} of ${publicState.playerCount} players voted`;
  if (list) {
    replaceProgressChipList(list, publicState.voteProgress ?? [], (player) => {
      const label = player.voted ? "Voted" : "Waiting";
      return player.playerId === currentPlayerId ? `You · ${label}` : `${player.name} · ${label}`;
    });
    for (const item of Array.from(list.children)) {
      const player = publicState.voteProgress?.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
      if (player?.voted) item.classList.add("progress-chip-done");
    }
  }
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
  onToggleHistory: () => void = () => {},
  onHistoryPage: (page: number) => void = () => {},
  onReturnFromResults: () => void = () => {},
): HTMLElement {
  const screen = element("section", "app-screen question-screen");
  if (!isBruhWtfPublicState(value)) {
    screen.append(element("h1", undefined, "Game starting"));
    return screen;
  }
  const state = value;
  const isFinalRound = state.currentRound === state.totalRounds;
  if (state.phase === "results" && state.results && isFinalRound) {
    const { results } = state;
    const finalLeaderboard = results.activeLeaderboard ?? results.leaderboard;
    const winners = results.activeWinners?.length
      ? results.activeWinners
      : results.winners?.length
        ? results.winners
        : finalLeaderboard.filter(({ rank }) => rank === 1);
    const winnerScore = finalLeaderboard.find(({ playerId }) => playerId === winners[0]?.playerId)?.score ?? 0;
    appendWinnerPresentation(screen, winners.map(({ name }) => name), `${winnerScore} points`);

    screen.append(
      element("h2", "results-section-heading", "Final leaderboard"),
      createStandingsList(finalLeaderboard.map(({ playerId, name, score, rank }) => ({
        playerId,
        name,
        totalScore: score,
        rank,
      })), { className: "final-leaderboard" }),
    );
    const history = (results.roundHistory ?? [{
      round: state.currentRound,
      prompt: results.prompt,
      answers: results.answers,
      roundScores: results.roundScores,
      leaderboard: results.leaderboard,
    }]).map((round) => {
      const scores = new Map(round.roundScores.map(({ playerId, pointsEarned }) => [playerId, pointsEarned]));
      return {
        gameName: gameDisplayName,
        round: round.round,
        prompt: round.prompt,
        sections: [{
          heading: "Answers",
          voterPrefix: "Voted by",
          noVotesText: "No votes",
          answers: round.answers.map((answer) => ({
            completion: answer.completion,
            authorName: answer.authorName,
            voterNames: answer.voterNames,
            voteCount: answer.voteCount,
          })),
        }],
        standings: round.leaderboard.map(({ playerId, name, score, rank }) => ({
          playerId,
          name,
          totalScore: score,
          rank,
        })),
        roundPointsByPlayer: scores,
      };
    });
    screen.append(createRoundHistorySection(history, view.historyPage ?? -1, view.historyOpen === true, onToggleHistory, onHistoryPage));
    if (isSessionFinished && view.isResultsViewer) {
      const returnButton = element("button", "primary-button", view.isReturningToLobby ? "Returning to lobby…" : "Return to Lobby");
      returnButton.type = "button";
      returnButton.disabled = view.isReturningToLobby;
      returnButton.addEventListener("click", onReturnFromResults);
      screen.append(returnButton);
    } else if (isSessionFinished && view.isHost) {
      const returnButton = element("button", "primary-button", view.isReturningToLobby ? "Returning to lobby…" : "Return to lobby");
      returnButton.disabled = view.isReturningToLobby;
      returnButton.addEventListener("click", onReturnToLobby);
      screen.append(returnButton);
    } else if (isSessionFinished) {
      screen.append(createStatusMessage("Waiting for the host to return everyone to the lobby…"));
    }
    if (view.returnToLobbyError) {
      const error = createStatusMessage(view.returnToLobbyError, "error-message");
      error.setAttribute("role", "alert");
      screen.append(error);
    }
    return screen;
  }

  const phaseTitle = state.phase === "voting"
    ? "Voting Round"
    : state.phase === "waiting-for-results"
      ? "All votes are in"
      : state.phase === "results"
        ? isFinalRound ? "Final results" : "Round results"
        : "Question";
  appendGameHeader(screen, gameDisplayName, phaseTitle, state.currentRound, state.totalRounds);
  screen.append(createQuestionText(state.phase === "results" && state.results ? state.results.prompt : state.prompt));

  if (state.phase === "answer-submission") {
    const submitted = state.submissionProgress?.some(({ playerId, submitted: done }) => playerId === view.currentPlayerId && done) === true;
    const [progress, list] = createSubmissionProgress(state.submissionCount ?? 0, state.playerCount, state.submissionProgress ?? [], view.currentPlayerId);
    list.classList.add("bruh-submission-player-list");
    screen.append(progress, list);
    updateBruhSubmissionProgress(screen, state, view.currentPlayerId);
    if (submitted) {
      const waitingCount = state.playerCount - (state.submissionCount ?? 0);
      screen.append(createStatusMessage(waitingCount > 0
        ? `Answer submitted. Waiting for ${waitingCount} ${waitingCount === 1 ? "player" : "players"}.`
        : "Answer submitted. Preparing the answers…"));
    } else {
      screen.append(createStatusMessage("Submit your answer when you’re ready."));
      if (view.submitError) {
        const error = createStatusMessage(view.submitError, "error-message");
        error.setAttribute("role", "alert");
        screen.append(error);
      }
      screen.append(createSubmissionForm({
        inputId: "bruh-answer",
        inputName: "answer",
        label: "Your answer",
        draft: view.answerDraft,
        isSubmitting: view.isSubmitting,
        onSubmit,
        onDraftChange,
      }));
    }
  } else if (state.phase === "voting") {
    const viewerVoted = view.hasVoted || state.voteProgress?.some(({ playerId, voted }) => playerId === view.currentPlayerId && voted) === true;
    screen.append(createStatusMessage("Answers are anonymous. Choose another player’s answer.", "screen-description"));
    const voteProgress = createVoteProgress(state.voteCount ?? 0, state.playerCount, state.voteProgress ?? [], view.currentPlayerId);
    voteProgress[0].classList.add("bruh-vote-progress");
    voteProgress[1].classList.add("bruh-vote-player-list");
    if (viewerVoted) {
      screen.append(...voteProgress);
      const waitingCount = state.playerCount - (state.voteCount ?? 0);
      screen.append(createStatusMessage(waitingCount > 0
        ? `Vote submitted. Waiting for ${waitingCount} ${waitingCount === 1 ? "player" : "players"}…`
        : "Vote submitted. Preparing results…", "status-message vote-accepted"));
    } else {
      screen.append(createVotingForm({
        answers: state.options ?? [],
        selectedOptionId: view.selectedOptionId,
        isSubmitting: view.isVoting,
        radioName: "bruh-vote",
        onSelect: onSelectVote,
        onSubmit: onVote,
      }));
      screen.append(...voteProgress);
    }
    if (view.voteError) {
      const error = createStatusMessage(view.voteError, "error-message");
      error.setAttribute("role", "alert");
      screen.append(error);
    }
  } else if (state.phase === "waiting-for-results") {
    screen.append(createStatusMessage("Waiting for results.", "screen-description"));
    screen.append(...createVoteProgress(state.voteCount ?? 0, state.playerCount, state.voteProgress ?? [], view.currentPlayerId));
  } else if (state.results) {
    const results = state.results;
    const answersHeading = element("h2", "results-section-heading", "Answers");
    const answers = element("ul", "result-card-list");
    for (const answer of results.answers) {
      answers.append(createAnswerResultCard({
        completion: answer.completion,
        authorName: answer.authorName,
        voteCount: answer.voteCount,
        voterNames: answer.voterNames,
        voterPrefix: "Voted by",
        noVotesText: "No votes",
      }));
    }
    screen.append(answersHeading, answers);
    const presentationStandings = (results.activeLeaderboard ?? results.leaderboard).map(({ playerId, name, score, rank }) => ({
      playerId,
      name,
      totalScore: score,
      rank,
    }));
    const roundPointsByPlayer = new Map(results.roundScores.map(({ playerId, pointsEarned }) => [playerId, pointsEarned]));
    screen.append(
      element("h2", "results-section-heading", "Current leaderboard"),
      createStandingsList(presentationStandings, { roundPointsByPlayer }),
    );
    appendContinueReadiness({
      screen,
      readyCount: state.continueReadyCount ?? 0,
      playerCount: state.continuePlayerCount ?? state.playerCount,
      players: state.continueProgress ?? [],
      viewerReady: state.viewerReadyToContinue === true,
      isContinuing: view.isContinuing,
      onContinue,
      error: view.continueError,
    });
  }
  return screen;
}
