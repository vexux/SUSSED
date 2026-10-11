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
  submittedCompletion: string;
  voteOptionId: string;
  voteCompletion: string;
  voteCorrect: boolean;
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
  options: FakeAnswerResultOption[];
  players: FakeAnswerResultPlayer[];
  standings: FakeAnswerStanding[];
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
  ["mostPlayersFooled", "Most players siked"],
  ["gotFooledMost", "Got siked the most"],
  ["mostCorrectAnswers", "Most correct answers"],
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
  const item = document.createElement("li");
  item.className = isCorrect
    ? "result-card result-card-correct real-answer-card"
    : "result-card";

  const answerHeading = document.createElement("div");
  answerHeading.className = "result-card-heading answer-card-main-row";
  const answerContent = document.createElement("div");
  answerContent.className = "answer-card-content";
  if (!isCorrect) {
    const author = document.createElement("span");
    author.className = "bluff-author";
    author.textContent = authorName ?? "Unknown player";
    const separator = document.createElement("span");
    separator.className = "bluff-author-separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "|";
    answerContent.append(author, separator);
  }
  const answer = document.createElement("span");
  answer.className = "result-answer-text answer-card-answer";
  answer.textContent = formatAnswerForDisplay(completion);
  answerContent.append(answer);

  const voteCount = document.createElement("span");
  voteCount.className = "answer-vote-count";
  voteCount.textContent = `${voters.length} vote${voters.length === 1 ? "" : "s"}`;
  answerHeading.append(answerContent, voteCount);

  const voterNames = document.createElement("p");
  voterNames.className = "result-detail";
  voterNames.textContent = voters.length > 0
    ? `Chosen by: ${voters.map(({ name }) => name).join(", ")}`
    : "No one chose this answer.";

  item.append(answerHeading, voterNames);
  return item;
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
  isReturningToLobby: boolean;
  returnToLobbyError: string | null;
  isRoundFeedbackDismissed: boolean;
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
      Array.isArray(value.results.options) &&
      value.results.options.length === value.playerCount + 1 &&
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
      value.results.players.length === value.playerCount &&
      value.results.players.every(
        (player) =>
          isRecord(player) &&
          typeof player.playerId === "string" &&
          typeof player.name === "string" &&
          typeof player.submittedCompletion === "string" &&
          typeof player.voteOptionId === "string" &&
          typeof player.voteCompletion === "string" &&
          typeof player.voteCorrect === "boolean" &&
          typeof player.correctVotePoints === "number" &&
          typeof player.bluffPoints === "number" &&
          typeof player.roundPoints === "number" &&
          typeof player.totalScore === "number",
      ) &&
      Array.isArray(value.results.standings) &&
      value.results.standings.length === value.playerCount &&
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
  playerList.replaceChildren();
  for (const player of publicState.submissionProgress ?? []) {
    const item = document.createElement("li");
    item.className = player.submitted ? "progress-chip progress-chip-done" : "progress-chip";
    item.dataset.playerId = player.playerId;
    const isCurrentPlayer = player.playerId === currentPlayerId;
    item.textContent = isCurrentPlayer
      ? player.submitted
        ? "You · Submitted"
        : "You · Waiting"
      : `${player.name} · ${player.submitted ? "Submitted" : "Waiting"}`;
    playerList.append(item);
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
  playerList.replaceChildren();
  for (const player of publicState.voteProgress ?? []) {
    const item = document.createElement("li");
    item.className = player.voted ? "progress-chip progress-chip-done" : "progress-chip";
    item.dataset.playerId = player.playerId;
    item.textContent = player.playerId === currentPlayerId
      ? player.voted ? "You · Voted" : "You · Waiting"
      : `${player.name} · ${player.voted ? "Voted" : "Waiting"}`;
    playerList.append(item);
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
): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "app-screen question-screen final-results-screen";
  const gameName = document.createElement("p");
  gameName.className = "screen-description";
  gameName.textContent = gameDisplayName;
  const title = document.createElement("h1");
  title.textContent = "Final results";
  const round = document.createElement("p");
  round.className = "round-counter";
  round.textContent = `Round ${publicState.currentRound} of ${publicState.totalRounds}`;
  screen.append(gameName, title, round);

  const results = publicState.results;
  if (!results || !publicState.finalStatistics) {
    return screen;
  }

  const winners = results.standings.filter(({ rank }) => rank === 1);
  const winnerHeading = document.createElement("h2");
  winnerHeading.className = "final-winner-heading";
  winnerHeading.textContent = winners.length > 1 ? "It's a tie!" : "Winner";
  const winnerNames = document.createElement("p");
  winnerNames.className = "final-winner-names";
  winnerNames.textContent = winners.map(({ name }) => name).join(", ");
  const winnerScores = document.createElement("p");
  winnerScores.className = "final-winner-scores";
  winnerScores.textContent = `${winners[0]?.totalScore ?? 0} points`;
  screen.append(winnerHeading, winnerNames, winnerScores);

  const leaderboardHeading = document.createElement("h2");
  leaderboardHeading.className = "results-section-heading";
  leaderboardHeading.textContent = "Final leaderboard";
  const leaderboard = document.createElement("ol");
  leaderboard.className = "result-card-list standings-list final-leaderboard";
  for (const standing of results.standings) {
    const item = document.createElement("li");
    item.className = "result-card standing-card";
    item.dataset.playerId = standing.playerId;
    const rank = document.createElement("span");
    rank.className = "standing-rank";
    rank.textContent = `#${standing.rank}`;
    const name = document.createElement("span");
    name.className = "standing-name";
    name.textContent = standing.name;
    const score = document.createElement("strong");
    score.className = "standing-score";
    score.textContent = `${standing.totalScore} point${standing.totalScore === 1 ? "" : "s"}`;
    item.append(rank, name, score);
    leaderboard.append(item);
  }
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
  onDismissFeedback: () => void,
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
    );
  }

  const title = document.createElement("h1");
  title.textContent = publicState.phase === "reveal"
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
  const round = document.createElement("p");
  round.className = "round-counter";
  round.textContent = `Round ${publicState.currentRound} of ${publicState.totalRounds}`;
  const gameName = document.createElement("p");
  gameName.className = "screen-description";
  gameName.textContent = gameDisplayName;
  screen.append(gameName, title, round);

  if (publicState.phase === "results" && publicState.results) {
    if (publicState.prompt) {
      const prompt = document.createElement("p");
      prompt.className = "question-text";
      prompt.textContent = publicState.prompt.text;
      screen.append(prompt);
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
    const standings = document.createElement("ol");
    standings.className = "result-card-list standings-list";
    for (const standing of publicState.results.standings) {
      const item = document.createElement("li");
      item.className = "result-card standing-card";
      const rank = document.createElement("span");
      rank.className = "standing-rank";
      rank.textContent = `#${standing.rank}`;
      const standingName = document.createElement("span");
      standingName.className = "standing-name";
      standingName.textContent = standing.name;
      const score = document.createElement("strong");
      score.className = "standing-score";
      score.textContent =
        `${standing.totalScore} point${standing.totalScore === 1 ? "" : "s"}`;
      const roundScore = document.createElement("span");
      const roundPoints = publicState.results.players.find(
        ({ playerId }) => playerId === standing.playerId,
      )?.roundPoints ?? 0;
      roundScore.className = roundPoints > 0
        ? "standing-round-score standing-round-score-positive"
        : roundPoints < 0
          ? "standing-round-score standing-round-score-negative"
          : "standing-round-score";
      roundScore.textContent = formatRoundPoints(roundPoints);
      roundScore.setAttribute(
        "aria-label",
        `Round points: ${formatRoundPoints(roundPoints)} points`,
      );
      item.append(rank, standingName, roundScore, score);
      standings.append(item);
    }
    screen.append(standingsHeading, standings);

    const continueProgress = document.createElement("p");
    continueProgress.className = "continue-progress";
    continueProgress.textContent =
      `${publicState.continueReadyCount} / ${publicState.continuePlayerCount} players ready to continue`;
    screen.append(continueProgress);

    const continuePlayerList = document.createElement("ul");
    continuePlayerList.className = "continue-player-list progress-chip-list";
    for (const player of publicState.continueProgress ?? []) {
      const item = document.createElement("li");
      item.className = player.ready
        ? "progress-chip progress-chip-done"
        : "progress-chip";
      item.dataset.playerId = player.playerId;
      item.textContent = `${player.name} · ${player.ready ? "Ready" : "Waiting"}`;
      continuePlayerList.append(item);
    }
    screen.append(continuePlayerList);

    if (publicState.viewerReadyToContinue) {
      const waiting = document.createElement("p");
      waiting.className = "status-message";
      waiting.textContent = "You’re ready. Waiting for the other players…";
      screen.append(waiting);
    } else {
      const continueButton = document.createElement("button");
      continueButton.className = "primary-button";
      continueButton.type = "button";
      continueButton.disabled = submission.isContinuing;
      continueButton.textContent = submission.isContinuing
        ? "Continuing…"
        : "Continue";
      continueButton.addEventListener("click", onContinue);
      screen.append(continueButton);
    }
    if (submission.continueError) {
      const error = document.createElement("p");
      error.className = "error-message";
      error.setAttribute("role", "alert");
      error.textContent = submission.continueError;
      screen.append(error);
    }
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
    const prompt = document.createElement("p");
    prompt.className = "question-text";
    prompt.textContent = publicState.prompt.text;
    screen.append(prompt);
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
    const progress = document.createElement("p");
    progress.className = "submission-progress";
    progress.setAttribute("aria-live", "polite");
    const playerList = document.createElement("ul");
    playerList.className = "submission-player-list progress-chip-list";
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
    const form = document.createElement("form");
    form.className = "submission-form";
    if (submission.submissionError) {
      const error = document.createElement("p");
      error.className = "error-message";
      error.setAttribute("role", "alert");
      error.textContent = submission.submissionError;
      screen.append(error);
    }
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = "fake-completion";
    label.textContent = "Your answer";
    const input = document.createElement("input");
    input.className = "text-input";
    input.id = "fake-completion";
    input.name = "completion";
    input.type = "text";
    input.maxLength = 160;
    input.required = true;
    input.autocomplete = "off";
    input.disabled = submission.isSubmitting;
    input.value = submission.completionDraft;
    const submit = document.createElement("button");
    submit.className = "primary-button";
    submit.type = "submit";
    submit.disabled = submission.isSubmitting;
    submit.textContent = submission.isSubmitting ? "Submitting…" : "Submit";
    form.append(label, input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onSubmit(input.value);
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
    const progress = document.createElement("p");
    progress.className = "vote-progress";
    const viewerHasVoted = publicState.voteProgress?.some(
      ({ playerId, voted }) =>
        playerId === submission.currentPlayerId && voted,
    ) === true;
    screen.append(instructions);

    if (viewerHasVoted) {
      const playerList = document.createElement("ul");
      playerList.className = "vote-player-list progress-chip-list";
      screen.append(progress, playerList);
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

    const form = document.createElement("form");
    form.className = "vote-form";
    for (const option of publicState.options ?? []) {
      const label = document.createElement("label");
      label.className = "vote-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "vote-option";
      input.value = option.id;
      input.checked = submission.selectedOptionId === option.id;
      input.disabled = submission.isVoting;
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
        input.addEventListener("change", () => onSelectVote(option.id));
      }
      const answer = document.createElement("span");
      answer.textContent = formatAnswerForDisplay(option.completion);
      label.append(input, answer);
      form.append(label);
    }
    const submit = document.createElement("button");
    submit.className = "primary-button";
    submit.type = "submit";
    submit.disabled = submission.isVoting || submission.selectedOptionId === null;
    submit.textContent = submission.isVoting ? "Submitting…" : "Submit";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submission.selectedOptionId) {
        onVote(submission.selectedOptionId);
      }
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
