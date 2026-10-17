import {
  appendContinueReadiness,
  appendGameHeader,
  appendWinnerPresentation,
  createAnswerResultCard,
  createQuestionText,
  createRoundHistorySection,
  createStandingsList,
  createSubmissionForm,
  createSubmissionProgress,
  createVoteProgress,
  createVotingForm,
  replaceProgressChipList,
} from "../ui/gamePresentation.ts";

export interface FakeAnswerOption {
  id: string;
  completion: string;
  isOwnAnswer: boolean;
}

export interface FakeAnswerResultOption {
  id: string;
  completion: string;
  authorId: string | null;
  authorName: string | null;
  isCorrect: boolean;
  voters: Array<{
    playerId: string;
    name: string;
  }>;
}

export interface FakeAnswerResultPlayer {
  playerId: string;
  name: string;
  submittedCompletion: string | null;
  voteOptionId: string | null;
  voteCompletion: string | null;
  voteCorrect: boolean | null;
  correctVotePoints: number;
  bluffPoints: number;
  roundPoints: number;
  totalScore: number;
}

export interface FakeAnswerStanding {
  playerId: string;
  name: string;
  totalScore: number;
  rank: number;
}

export interface FakeAnswerFinalStatistic {
  playerIds: string[];
  count: number;
}

export interface FakeAnswerFinalStatistics {
  mostPlayersFooled: FakeAnswerFinalStatistic;
  gotFooledMost: FakeAnswerFinalStatistic;
  mostCorrectAnswers: FakeAnswerFinalStatistic;
}

export interface FakeAnswerResults {
  correctCompletion: string;
  roundPlayerCount: number;
  options: FakeAnswerResultOption[];
  players: FakeAnswerResultPlayer[];
  standings: FakeAnswerStanding[];
  roundHistory?: Array<FakeAnswerResults & { round: number; prompt: string }>;
}

export function getRevealAnswerGroups(options: FakeAnswerResultOption[]): {
  realOption: FakeAnswerResultOption | null;
  fakeOptions: FakeAnswerResultOption[];
} {
  return {
    realOption: options.find(({ isCorrect }) => isCorrect) ?? null,
    fakeOptions: options.filter(({ isCorrect }) => !isCorrect),
  };
}

export function formatRoundPoints(points: number): string {
  return `${points >= 0 ? "+" : ""}${points}`;
}

export const VOTING_ROUND_HEADING = "Voting Round";
export const FINAL_STATISTIC_LABELS = [
  ["mostPlayersFooled", "Professional Liar"],
  ["gotFooledMost", "Gullible Legend"],
  ["mostCorrectAnswers", "The Nerd"],
] as const;

export function getPersonalRoundFeedback(
  results: FakeAnswerResults,
  currentPlayerId: string | null,
): { outcome: "correct" | "fooled" | "neutral"; title: string; detail: string } {
  const player = results.players.find(
    ({ playerId }) => playerId === currentPlayerId,
  );
  const selectedOption = player
    ? results.options.find(({ id }) => id === player.voteOptionId)
    : undefined;
  if (selectedOption?.isCorrect && player) {
    return {
      outcome: "correct",
      title: "Correct!",
      detail: `+${player.correctVotePoints} points`,
    };
  }
  if (
    selectedOption?.authorId &&
    selectedOption.authorId !== currentPlayerId &&
    selectedOption.authorName
  ) {
    return {
      outcome: "fooled",
      title: "Sike!",
      detail: `${selectedOption.authorName} got you!`,
    };
  }
  return { outcome: "neutral", title: "No vote submitted", detail: "" };
}

function createRevealAnswerCard(
  completion: string,
  voters: FakeAnswerResultOption["voters"],
  authorName: string | null,
  isCorrect: boolean,
): HTMLLIElement {
  return createAnswerResultCard({
    completion,
    authorName: isCorrect ? null : authorName ?? "Unknown player",
    voteCount: voters.length,
    voterNames: voters.map(({ name }) => name),
    formatAnswer: formatAnswerForDisplay,
    isCorrect,
    voterPrefix: "Chosen by",
    noVotesText: "No one chose this answer.",
  });
}

export interface FakeAnswerPublicState {
  phase:
    | "question"
    | "answer-submission"
    | "reveal"
    | "voting"
    | "waiting-for-results"
    | "results";
  currentRound: number;
  totalRounds: number;
  roundId: string;
  prompt: {
    id: string;
    text: string;
  } | null;
  submissionCount: number;
  playerCount: number;
  submissionProgress?: Array<{
    playerId: string;
    name: string;
    submitted: boolean;
  }>;
  voteProgress?: Array<{
    playerId: string;
    name: string;
    voted: boolean;
  }>;
  options?: FakeAnswerOption[];
  voteCount?: number;
  isFinalRound?: boolean;
  continueReadyCount?: number;
  continuePlayerCount?: number;
  viewerReadyToContinue?: boolean;
  continueProgress?: Array<{
    playerId: string;
    name: string;
    ready: boolean;
  }>;
  finalStatistics?: FakeAnswerFinalStatistics;
  results?: FakeAnswerResults;
}

export interface FakeAnswerViewState {
  currentPlayerId: string | null;
  hasSubmitted: boolean;
  completionDraft: string;
  isSubmitting: boolean;
  submissionError: string | null;
  hasVoted: boolean;
  isVoting: boolean;
  selectedOptionId: string | null;
  voteError: string | null;
  isContinuing: boolean;
  continueError: string | null;
  isHost: boolean;
  isResultsViewer?: boolean;
  isReturningToLobby: boolean;
  returnToLobbyError: string | null;
  isRoundFeedbackDismissed: boolean;
  historyOpen?: boolean;
  historyPage?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinalStatistic(
  value: unknown,
  playerIds: Set<string>,
): value is FakeAnswerFinalStatistic {
  return (
    isRecord(value) &&
    Number.isInteger(value.count) &&
    (value.count as number) >= 0 &&
    Array.isArray(value.playerIds) &&
    value.playerIds.every(
      (playerId) => typeof playerId === "string" && playerIds.has(playerId),
    ) &&
    new Set(value.playerIds).size === value.playerIds.length &&
    ((value.count as number) === 0
      ? value.playerIds.length === 0
      : value.playerIds.length > 0)
  );
}

function isFinalStatistics(
  value: unknown,
  standings: unknown,
): value is FakeAnswerFinalStatistics {
  if (!isRecord(value) || !Array.isArray(standings)) {
    return false;
  }
  const playerIds = new Set(
    standings
      .filter(isRecord)
      .map(({ playerId }) => playerId)
      .filter((playerId): playerId is string => typeof playerId === "string"),
  );
  return (
    ["mostPlayersFooled", "gotFooledMost", "mostCorrectAnswers"] as const
  ).every((key) => isFinalStatistic(value[key], playerIds));
}

export function isFakeAnswerPublicState(
  value: unknown,
): value is FakeAnswerPublicState {
  if (!isRecord(value)) {
    return false;
  }

  const promptIsValid =
    value.prompt === null ||
    (isRecord(value.prompt) &&
      typeof value.prompt.id === "string" &&
      typeof value.prompt.text === "string");
  const optionsAreValid =
    value.options === undefined ||
    (Array.isArray(value.options) &&
      value.options.every(
        (option) =>
          isRecord(option) &&
          typeof option.id === "string" &&
          typeof option.completion === "string" &&
          typeof option.isOwnAnswer === "boolean" &&
          Object.keys(option).sort().join(",") ===
            "completion,id,isOwnAnswer",
      ));
  const phaseIsValid =
    value.phase === "question" ||
    value.phase === "answer-submission" ||
    value.phase === "reveal" ||
    value.phase === "voting" ||
    value.phase === "waiting-for-results" ||
    value.phase === "results";
  const submissionProgressIsValid =
    value.phase !== "answer-submission" ||
    (Array.isArray(value.submissionProgress) &&
      value.submissionProgress.length === value.playerCount &&
      value.submissionProgress.every(
        (player) =>
          isRecord(player) &&
          typeof player.playerId === "string" &&
          typeof player.name === "string" &&
          typeof player.submitted === "boolean",
      ) &&
      new Set(
        value.submissionProgress
          .filter(isRecord)
          .map((player) => player.playerId),
      ).size === value.playerCount &&
      value.submissionProgress.filter(
        (player) => isRecord(player) && player.submitted === true,
      ).length === value.submissionCount);
  const voteProgressIsValid =
    (value.phase !== "voting" && value.phase !== "waiting-for-results") ||
    (Array.isArray(value.voteProgress) &&
      value.voteProgress.length === value.playerCount &&
      value.voteProgress.every(
        (player) =>
          isRecord(player) &&
          typeof player.playerId === "string" &&
          typeof player.name === "string" &&
          typeof player.voted === "boolean",
      ) &&
      new Set(
        value.voteProgress
          .filter(isRecord)
          .map((player) => player.playerId),
      ).size === value.playerCount &&
      typeof value.voteCount === "number" &&
      value.voteProgress.filter(
        (player) => isRecord(player) && player.voted === true,
      ).length === value.voteCount);
  const resultsAreValid =
    value.phase !== "results" ||
    (isRecord(value.results) &&
      typeof value.playerCount === "number" &&
      typeof value.isFinalRound === "boolean" &&
      typeof value.results.correctCompletion === "string" &&
      typeof value.results.roundPlayerCount === "number" &&
      value.results.roundPlayerCount >= value.playerCount &&
      Array.isArray(value.results.options) &&
      value.results.options.length >= 2 &&
      value.results.options.length <= value.results.roundPlayerCount + 1 &&
      value.results.options.every(
        (option) =>
          isRecord(option) &&
          typeof option.id === "string" &&
          typeof option.completion === "string" &&
          (typeof option.authorId === "string" || option.authorId === null) &&
          (typeof option.authorName === "string" || option.authorName === null) &&
          typeof option.isCorrect === "boolean" &&
          Array.isArray(option.voters) &&
          option.voters.every(
            (voter) =>
              isRecord(voter) &&
              typeof voter.playerId === "string" &&
              typeof voter.name === "string",
          ),
      ) &&
      new Set(
        value.results.options
          .filter(isRecord)
          .map((option) => option.id),
      ).size === value.results.options.length &&
      value.results.options.filter(
        (option) => isRecord(option) && option.isCorrect === true,
      ).length === 1 &&
      Array.isArray(value.results.players) &&
      value.results.players.length === value.results.roundPlayerCount &&
      value.results.players.every(
        (player) =>
          isRecord(player) &&
          typeof player.playerId === "string" &&
          typeof player.name === "string" &&
          (typeof player.submittedCompletion === "string" || player.submittedCompletion === null) &&
          (typeof player.voteOptionId === "string" || player.voteOptionId === null) &&
          (typeof player.voteCompletion === "string" || player.voteCompletion === null) &&
          (typeof player.voteCorrect === "boolean" || player.voteCorrect === null) &&
          typeof player.correctVotePoints === "number" &&
          typeof player.bluffPoints === "number" &&
          typeof player.roundPoints === "number" &&
          typeof player.totalScore === "number",
      ) &&
      Array.isArray(value.results.standings) &&
      value.results.standings.length >= value.results.roundPlayerCount &&
      value.results.standings.every(
        (standing) =>
          isRecord(standing) &&
          typeof standing.playerId === "string" &&
          typeof standing.name === "string" &&
          typeof standing.totalScore === "number" &&
          typeof standing.rank === "number",
      ) &&
      (value.isFinalRound === true
        ? isFinalStatistics(value.finalStatistics, value.results.standings)
        : typeof value.continueReadyCount === "number" &&
          typeof value.continuePlayerCount === "number" &&
          typeof value.viewerReadyToContinue === "boolean" &&
          Array.isArray(value.continueProgress) &&
          value.continueProgress.length === value.playerCount &&
          value.continueProgress.every(
            (player) =>
              isRecord(player) &&
              typeof player.playerId === "string" &&
              typeof player.name === "string" &&
              typeof player.ready === "boolean",
          ) &&
          new Set(
            value.continueProgress
              .filter(isRecord)
              .map((player) => player.playerId),
          ).size === value.playerCount &&
          value.continueProgress.filter(
            (player) => isRecord(player) && player.ready === true,
          ).length === value.continueReadyCount));

  return (
    phaseIsValid &&
    submissionProgressIsValid &&
    voteProgressIsValid &&
    typeof value.currentRound === "number" &&
    typeof value.totalRounds === "number" &&
    typeof value.roundId === "string" &&
    typeof value.submissionCount === "number" &&
    typeof value.playerCount === "number" &&
    promptIsValid &&
    optionsAreValid &&
    resultsAreValid &&
    ((value.phase !== "reveal" && value.phase !== "voting") ||
      (Array.isArray(value.options) &&
        value.options.length === value.playerCount + 1 &&
        value.options.filter(
          (option) => isRecord(option) && option.isOwnAnswer === true,
        ).length === 1)) &&
    ((value.phase !== "voting" && value.phase !== "waiting-for-results") ||
      typeof value.voteCount === "number")
  );
}

export function updateFakeAnswerProgress(
  root: ParentNode,
  publicState: unknown,
  currentPlayerId: string | null,
): boolean {
  if (
    !isFakeAnswerPublicState(publicState) ||
    publicState.phase !== "answer-submission"
  ) {
    return false;
  }

  const progress = root.querySelector<HTMLElement>(".submission-progress");
  const playerList = root.querySelector<HTMLUListElement>(
    ".submission-player-list",
  );
  if (!progress || !playerList) {
    return false;
  }
  const currentPlayer = publicState.submissionProgress?.find(
    ({ playerId }) => playerId === currentPlayerId,
  );
  if (!currentPlayer) {
    return false;
  }

  progress.textContent =
    `${publicState.submissionCount} of ${publicState.playerCount} answers submitted`;
  replaceProgressChipList(playerList, publicState.submissionProgress ?? [], (player) => {
    const status = player.submitted ? "Submitted" : "Waiting";
    return player.playerId === currentPlayerId ? `You · ${status}` : `${player.name} · ${status}`;
  });
  for (const item of Array.from(playerList.children)) {
    const player = publicState.submissionProgress?.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
    if (player?.submitted) item.className = "progress-chip progress-chip-done";
  }
  // A local successful submission changes the form into its submitted state;
  // let the normal render perform that transition. Remote progress updates
  // can update these nodes without replacing an unsubmitted player's input.
  return !currentPlayer.submitted;
}

export function updateFakeAnswerVoteProgress(
  root: ParentNode,
  publicState: unknown,
  currentPlayerId: string | null,
): boolean {
  if (
    !isFakeAnswerPublicState(publicState) ||
    (publicState.phase !== "voting" &&
      publicState.phase !== "waiting-for-results") ||
    typeof publicState.voteCount !== "number"
  ) {
    return false;
  }

  const progress = root.querySelector<HTMLElement>(".vote-progress");
  const playerList = root.querySelector<HTMLUListElement>(".vote-player-list");
  if (!progress || !playerList) {
    return false;
  }
  progress.textContent =
    `${publicState.voteCount} of ${publicState.playerCount} players voted`;
  replaceProgressChipList(playerList, publicState.voteProgress ?? [], (player) => {
    const status = player.voted ? "Voted" : "Waiting";
    return player.playerId === currentPlayerId ? `You · ${status}` : `${player.name} · ${status}`;
  });
  for (const item of Array.from(playerList.children)) {
    const player = publicState.voteProgress?.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
    if (player?.voted) item.className = "progress-chip progress-chip-done";
  }
  return true;
}

function formatAnswerForDisplay(answer: string): string {
  return answer.toLowerCase();
}

function appendRoundFeedback(
  screen: HTMLElement,
  publicState: FakeAnswerPublicState,
  submission: FakeAnswerViewState,
  onDismissFeedback: () => void,
): void {
  if (submission.isRoundFeedbackDismissed) {
    return;
  }
  const feedback = publicState.results
    ? getPersonalRoundFeedback(publicState.results, submission.currentPlayerId)
    : { outcome: "neutral" as const, title: "No vote submitted", detail: "" };

  const content = document.createElement("div");
  content.className = "reveal-content";
  content.inert = true;
  const heading = screen.querySelector("h1");
  if (heading) {
    heading.tabIndex = -1;
  }
  while (screen.firstChild) {
    content.append(screen.firstChild);
  }
  screen.append(content);

  const backdrop = document.createElement("div");
  backdrop.className = "round-feedback-backdrop";
  const dialog = document.createElement("section");
  dialog.className = `round-feedback-dialog round-feedback-${feedback.outcome}`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "round-feedback-title");
  const titleElement = document.createElement("h2");
  titleElement.id = "round-feedback-title";
  titleElement.textContent = feedback.title;
  dialog.append(titleElement);
  if (feedback.detail) {
    const detailElement = document.createElement("p");
    detailElement.className = "round-feedback-detail";
    detailElement.textContent = feedback.detail;
    dialog.append(detailElement);
  }
  const continueButton = document.createElement("button");
  continueButton.className = "primary-button round-feedback-continue";
  continueButton.type = "button";
  continueButton.textContent = "Continue";
  const dismiss = (): void => {
    onDismissFeedback();
    document.querySelector<HTMLElement>(".question-screen h1")?.focus();
  };
  continueButton.addEventListener("click", dismiss);
  dialog.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      continueButton.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });
  dialog.append(continueButton);
  backdrop.append(dialog);
  screen.append(backdrop);
  queueMicrotask(() => {
    if (dialog.isConnected) {
      const appHeader = document.querySelector<HTMLElement>(".app-header");
      if (appHeader) {
        appHeader.inert = true;
      }
      continueButton.focus();
    }
  });
}

function createFinalResultsScreen(
  publicState: FakeAnswerPublicState,
  submission: FakeAnswerViewState,
  gameDisplayName: string,
  onReturnToLobby: () => void,
  onDismissFeedback: () => void,
  onToggleHistory: () => void,
  onHistoryPage: (page: number) => void,
  onReturnFromResults: () => void,
): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "app-screen question-screen final-results-screen";

  const results = publicState.results;
  if (!results || !publicState.finalStatistics) {
    return screen;
  }

  const winners = results.standings.filter(({ rank }) => rank === 1);
  appendWinnerPresentation(screen, winners.map(({ name }) => name), `${winners[0]?.totalScore ?? 0} points`);

  const leaderboardHeading = document.createElement("h2");
  leaderboardHeading.className = "results-section-heading";
  leaderboardHeading.textContent = "Final leaderboard";
  const leaderboard = createStandingsList(results.standings, { className: "final-leaderboard" });
  screen.append(leaderboardHeading, leaderboard);

  const statisticsHeading = document.createElement("h2");
  statisticsHeading.className = "results-section-heading";
  statisticsHeading.textContent = "Fun statistics";
  const statistics = document.createElement("ul");
  statistics.className = "final-statistics";
  for (const [key, label] of FINAL_STATISTIC_LABELS) {
    const statistic = publicState.finalStatistics[key];
    const row = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = label;
    const winnersText = document.createElement("span");
    winnersText.textContent = statistic.playerIds.length > 0
      ? statistic.playerIds
          .map(
            (playerId) =>
              results.standings.find((standing) => standing.playerId === playerId)
                ?.name ?? "Unknown player",
          )
          .join(", ")
      : "No winner";
    row.append(name, winnersText);
    statistics.append(row);
  }
  screen.append(statisticsHeading, statistics);

  const history = (results.roundHistory ?? [
    { ...results, round: publicState.currentRound, prompt: publicState.prompt?.text ?? "" },
  ]).map((round) => {
    const { realOption, fakeOptions } = getRevealAnswerGroups(round.options);
    return {
      gameName: gameDisplayName,
      round: round.round,
      prompt: round.prompt,
      sections: [
        { heading: "Correct Answer", voterPrefix: "Chosen by", noVotesText: "No one chose this answer.", formatAnswer: formatAnswerForDisplay, answers: realOption ? [{
          completion: realOption.completion,
          authorName: null,
          voterNames: realOption.voters.map(({ name }) => name),
          voteCount: realOption.voters.length,
          isCorrect: true,
        }] : [] },
        { heading: "Bluff answers", voterPrefix: "Chosen by", noVotesText: "No one chose this answer.", formatAnswer: formatAnswerForDisplay, answers: fakeOptions.map((option) => ({
          completion: option.completion,
          authorName: option.authorName,
          voterNames: option.voters.map(({ name }) => name),
          voteCount: option.voters.length,
        })) },
      ],
      standings: round.standings,
      roundPointsByPlayer: new Map(round.players.map(({ playerId, roundPoints }) => [playerId, roundPoints])),
    };
  });
  screen.append(createRoundHistorySection(
    history,
    submission.historyPage ?? -1,
    submission.historyOpen === true,
    onToggleHistory,
    onHistoryPage,
  ));

  const finished = document.createElement("p");
  finished.className = "status-message";
  finished.textContent = "The game is complete.";
  screen.append(finished);
  if (submission.isHost) {
    const returnButton = document.createElement("button");
    returnButton.className = "primary-button";
    returnButton.type = "button";
    returnButton.disabled = submission.isReturningToLobby;
    returnButton.textContent = submission.isReturningToLobby
      ? "Returning to lobby…"
      : "Return to lobby";
    returnButton.addEventListener("click", onReturnToLobby);
    screen.append(returnButton);
  } else if (submission.isResultsViewer) {
    const returnButton = document.createElement("button");
    returnButton.className = "primary-button";
    returnButton.type = "button";
    returnButton.disabled = submission.isReturningToLobby;
    returnButton.textContent = submission.isReturningToLobby ? "Returning to lobby…" : "Return to Lobby";
    returnButton.addEventListener("click", onReturnFromResults);
    screen.append(returnButton);
  } else {
    const waiting = document.createElement("p");
    waiting.className = "status-message";
    waiting.textContent = "Waiting for the host to return everyone to the lobby…";
    screen.append(waiting);
  }
  if (submission.returnToLobbyError) {
    const error = document.createElement("p");
    error.className = "error-message";
    error.setAttribute("role", "alert");
    error.textContent = submission.returnToLobbyError;
    screen.append(error);
  }
  appendRoundFeedback(screen, publicState, submission, onDismissFeedback);
  return screen;
}

export function renderFakeAnswerGame(
  publicState: unknown,
  submission: FakeAnswerViewState,
  onSubmit: (completion: string) => void,
  onSelectVote: (optionId: string) => void,
  onVote: (optionId: string) => void,
  onContinue: () => void,
  onReturnToLobby: () => void,
  gameDisplayName: string,
  isSessionFinished: boolean,
  onDismissFeedback: () => void = () => {},
  onToggleHistory: () => void = () => {},
  onHistoryPage: (page: number) => void = () => {},
  onReturnFromResults: () => void = () => {},
): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "app-screen question-screen";

  if (!isFakeAnswerPublicState(publicState)) {
    const title = document.createElement("h1");
    title.textContent = "Game starting";
    screen.append(title);
    return screen;
  }

  if (
    publicState.phase === "results" &&
    publicState.isFinalRound === true &&
    isSessionFinished &&
    publicState.finalStatistics
  ) {
    return createFinalResultsScreen(
      publicState,
      submission,
      gameDisplayName,
      onReturnToLobby,
      onDismissFeedback,
      onToggleHistory,
      onHistoryPage,
      onReturnFromResults,
    );
  }

  const titleText = publicState.phase === "reveal"
    ? "Answers revealed"
    : publicState.phase === "voting"
      ? VOTING_ROUND_HEADING
      : publicState.phase === "waiting-for-results"
        ? "All votes are in"
        : publicState.phase === "results"
          ? publicState.isFinalRound
            ? "Final results"
            : "Round results"
        : "Question";
  appendGameHeader(screen, gameDisplayName, titleText, publicState.currentRound, publicState.totalRounds);

  if (publicState.phase === "results" && publicState.results) {
    if (publicState.prompt) {
      screen.append(createQuestionText(publicState.prompt.text));
    }
    const { realOption, fakeOptions } = getRevealAnswerGroups(
      publicState.results.options,
    );
    const realHeading = document.createElement("h2");
    realHeading.className = "results-section-heading";
    realHeading.textContent = "Correct Answer";
    const realVoters = realOption?.voters ?? [];
    const realOptions = document.createElement("ul");
    realOptions.className = "result-card-list";
    realOptions.append(
      createRevealAnswerCard(
        realOption?.completion ?? publicState.results.correctCompletion,
        realVoters,
        null,
        true,
      ),
    );
    screen.append(realHeading, realOptions);

    const optionsHeading = document.createElement("h2");
    optionsHeading.className = "results-section-heading";
    optionsHeading.textContent = "Bluff answers";
    const options = document.createElement("ul");
    options.className = "result-card-list";
    for (const option of fakeOptions) {
      options.append(
        createRevealAnswerCard(
          option.completion,
          option.voters,
          option.authorName,
          false,
        ),
      );
    }
    screen.append(optionsHeading, options);

    const standingsHeading = document.createElement("h2");
    standingsHeading.className = "results-section-heading";
    standingsHeading.textContent = "Current leaderboard";
    const roundPointsByPlayer = new Map(publicState.results.players.map(({ playerId, roundPoints }) => [playerId, roundPoints]));
    const standings = createStandingsList(publicState.results.standings, { roundPointsByPlayer });
    screen.append(standingsHeading, standings);
    appendContinueReadiness({
      screen,
      readyCount: publicState.continueReadyCount ?? 0,
      playerCount: publicState.continuePlayerCount ?? publicState.playerCount,
      players: publicState.continueProgress ?? [],
      viewerReady: publicState.viewerReadyToContinue === true,
      isContinuing: submission.isContinuing,
      onContinue,
      error: submission.continueError,
    });
    appendRoundFeedback(screen, publicState, submission, onDismissFeedback);
    return screen;
  }

  if (publicState.phase === "waiting-for-results") {
    const waiting = document.createElement("p");
    waiting.className = "screen-description";
    waiting.textContent = "Waiting for results.";
    const progress = document.createElement("p");
    progress.className = "vote-progress";
    const playerList = document.createElement("ul");
    playerList.className = "vote-player-list progress-chip-list";
    screen.append(waiting, progress, playerList);
    updateFakeAnswerVoteProgress(screen, publicState, submission.currentPlayerId);
    return screen;
  }

  if (publicState.prompt) {
    screen.append(createQuestionText(publicState.prompt.text));
  }

  if (publicState.phase === "question") {
    const preparing = document.createElement("p");
    preparing.className = "status-message";
    preparing.textContent = "Get ready to complete the fact.";
    screen.append(preparing);
    return screen;
  }

  if (publicState.phase === "answer-submission") {
    const viewerHasSubmitted = publicState.submissionProgress?.some(
      ({ playerId, submitted }) =>
        playerId === submission.currentPlayerId && submitted,
    ) === true;
    const [progress, playerList] = createSubmissionProgress(
      publicState.submissionCount,
      publicState.playerCount,
      publicState.submissionProgress ?? [],
      submission.currentPlayerId,
    );
    if (viewerHasSubmitted) {
      screen.append(progress, playerList);
      updateFakeAnswerProgress(screen, publicState, submission.currentPlayerId);
      const submitted = document.createElement("p");
      submitted.className = "status-message";
      const waitingCount = publicState.playerCount - publicState.submissionCount;
      submitted.textContent = waitingCount > 0
        ? `Answer submitted. Waiting for ${waitingCount} ${waitingCount === 1 ? "player" : "players"}.`
        : "Answer submitted. Preparing the answers…";
      screen.append(submitted);
      return screen;
    }

    const waiting = document.createElement("p");
    waiting.className = "status-message";
    waiting.textContent = "Submit your answer when you’re ready.";
    screen.append(waiting, progress, playerList);
    updateFakeAnswerProgress(screen, publicState, submission.currentPlayerId);
    if (submission.submissionError) {
      const error = document.createElement("p");
      error.className = "error-message";
      error.setAttribute("role", "alert");
      error.textContent = submission.submissionError;
      screen.append(error);
    }
    const form = createSubmissionForm({
      inputId: "fake-completion",
      inputName: "completion",
      label: "Your answer",
      draft: submission.completionDraft,
      isSubmitting: submission.isSubmitting,
      onSubmit,
    });
    screen.append(form);
  }

  if (publicState.phase === "reveal") {
    const revealedOptions = document.createElement("ul");
    revealedOptions.className = "revealed-options";
    for (const option of publicState.options ?? []) {
      const item = document.createElement("li");
      item.textContent = formatAnswerForDisplay(option.completion);
      revealedOptions.append(item);
    }
    screen.append(revealedOptions);
    return screen;
  }

  if (publicState.phase === "voting") {
    const instructions = document.createElement("p");
    instructions.className = "screen-description voting-instructions";
    instructions.textContent = "Choose the real completion.";
    const viewerHasVoted = publicState.voteProgress?.some(
      ({ playerId, voted }) =>
        playerId === submission.currentPlayerId && voted,
    ) === true;
    screen.append(instructions);

    if (viewerHasVoted) {
      screen.append(...createVoteProgress(
        publicState.voteCount ?? 0,
        publicState.playerCount,
        publicState.voteProgress ?? [],
        submission.currentPlayerId,
      ));
      updateFakeAnswerVoteProgress(screen, publicState, submission.currentPlayerId);
      const waiting = document.createElement("p");
      waiting.className = "status-message vote-accepted";
      const waitingCount = publicState.playerCount - (publicState.voteCount ?? 0);
      waiting.textContent = waitingCount > 0
        ? `Vote submitted. Waiting for ${waitingCount} ${waitingCount === 1 ? "player" : "players"}…`
        : "Vote submitted. Preparing results…";
      screen.append(waiting);
      return screen;
    }

    const form = createVotingForm({
      answers: publicState.options ?? [],
      selectedOptionId: submission.selectedOptionId,
      isSubmitting: submission.isVoting,
      radioName: "vote-option",
      formatAnswer: formatAnswerForDisplay,
      onSelect: onSelectVote,
      onSubmit: onVote,
    });
    screen.append(form);
  }

  if (submission.voteError) {
    const error = document.createElement("p");
    error.className = "error-message";
    error.setAttribute("role", "alert");
    error.textContent = submission.voteError;
    screen.append(error);
  }

  return screen;
}
