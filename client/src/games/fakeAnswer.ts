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
  if (!currentPlayer?.submitted) {
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
  return true;
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
  const personalResult = publicState.results?.players.find(
    ({ playerId }) => playerId === submission.currentPlayerId,
  );
  let message = "No vote submitted this round.";
  let feedbackClass = "personal-result-feedback";
  if (personalResult) {
    const selectedResult = publicState.results?.options.find(
      ({ id }) => id === personalResult.voteOptionId,
    );
    if (selectedResult?.isCorrect) {
      message = "Correct! +2 points";
      feedbackClass += " personal-result-correct";
    } else if (
      selectedResult?.authorId !== null &&
      selectedResult?.authorId !== undefined &&
      selectedResult.authorId !== submission.currentPlayerId
    ) {
      message = `Sike! You got fooled by ${selectedResult.authorName ?? "another player"}!`;
      feedbackClass += " personal-result-fooled";
    }
  }

  const feedback = document.createElement("aside");
  feedback.className = `round-feedback ${feedbackClass}`;
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  const messageElement = document.createElement("span");
  messageElement.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.className = "feedback-dismiss";
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss round feedback");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", onDismissFeedback);
  feedback.append(messageElement, dismiss);
  screen.append(feedback);
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
  appendRoundFeedback(screen, publicState, submission, onDismissFeedback);

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
  const statisticLabels = [
    ["mostPlayersFooled", "Most players fooled"],
    ["gotFooledMost", "Got fooled the most"],
    ["mostCorrectAnswers", "Most correct answers"],
  ] as const;
  for (const [key, label] of statisticLabels) {
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
      ? "Vote for the real completion"
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
    const correctHeading = document.createElement("h2");
    correctHeading.className = "results-section-heading";
    correctHeading.textContent = "The real completion";
    const correct = document.createElement("p");
    correct.className = "correct-completion";
    correct.textContent = formatAnswerForDisplay(publicState.results.correctCompletion);
    screen.append(correctHeading, correct);

    const optionsHeading = document.createElement("h2");
    optionsHeading.className = "results-section-heading";
    optionsHeading.textContent = "Answers and votes";
    const options = document.createElement("ul");
    options.className = "result-card-list";
    for (const option of publicState.results.options) {
      const item = document.createElement("li");
      item.className = option.isCorrect
        ? "result-card result-card-correct"
        : "result-card";
      const answerHeading = document.createElement("div");
      answerHeading.className = "result-card-heading";
      const answerType = document.createElement("span");
      answerType.className = option.isCorrect
        ? "answer-badge answer-badge-correct"
        : "answer-badge answer-badge-fake";
      answerType.textContent = option.isCorrect
        ? "Real answer"
        : `Bluff by ${option.authorName}`;
      const voteCount = document.createElement("span");
      voteCount.className = "answer-vote-count";
      voteCount.textContent =
        `${option.voters.length} vote${option.voters.length === 1 ? "" : "s"}`;
      answerHeading.append(answerType, voteCount);

      const answer = document.createElement("p");
      answer.className = "result-answer-text";
      answer.textContent = formatAnswerForDisplay(option.completion);
      const voters = document.createElement("p");
      voters.className = "result-detail";
      voters.textContent = option.voters.length > 0
        ? `Chosen by: ${option.voters.map(({ name }) => name).join(", ")}`
        : "No one chose this answer.";
      item.append(answerHeading, answer, voters);
      if (!option.isCorrect) {
        const bluffAward = document.createElement("p");
        bluffAward.className = "result-award";
        bluffAward.textContent =
          `Bluff reward: ${option.voters.length} point${option.voters.length === 1 ? "" : "s"} to ${option.authorName}`;
        item.append(bluffAward);
      }
      options.append(item);
    }
    screen.append(optionsHeading, options);

    appendRoundFeedback(
      screen,
      publicState,
      submission,
      onDismissFeedback,
    );

    const playerResultsHeading = document.createElement("h2");
    playerResultsHeading.className = "results-section-heading";
    playerResultsHeading.textContent = "Player score breakdown";
    const playerResults = document.createElement("ul");
    playerResults.className = "result-card-list player-score-list";
    for (const player of publicState.results.players) {
      const item = document.createElement("li");
      item.className = "result-card player-score-card";
      const name = document.createElement("h3");
      name.className = "player-score-name";
      name.textContent = player.name;
      const submitted = document.createElement("p");
      submitted.className = "result-detail";
      submitted.textContent =
        `Your submitted answer: “${formatAnswerForDisplay(player.submittedCompletion)}”`;
      const vote = document.createElement("p");
      vote.className = player.voteCorrect
        ? "result-detail vote-correct"
        : "result-detail vote-incorrect";
      vote.textContent =
        `Voted for “${formatAnswerForDisplay(player.voteCompletion)}” — ${player.voteCorrect ? "correct" : "incorrect"}`;
      const scoreReasons = document.createElement("ul");
      scoreReasons.className = "score-reasons";
      const correctReason = document.createElement("li");
      correctReason.textContent = player.correctVotePoints > 0
        ? `+${player.correctVotePoints} for finding the real answer (+2 per correct vote)`
        : "0 for the vote (not the real answer)";
      const bluffReason = document.createElement("li");
      bluffReason.textContent = player.bluffPoints > 0
        ? `+${player.bluffPoints} from votes for your bluff`
        : "0 from votes for your bluff";
      const scoreSummary = document.createElement("p");
      scoreSummary.className = "score-summary";
      scoreSummary.textContent =
        `Round: +${player.roundPoints} · Total: ${player.totalScore}`;
      scoreReasons.append(correctReason, bluffReason);
      item.append(name, submitted, vote, scoreReasons, scoreSummary);
      playerResults.append(item);
    }
    screen.append(playerResultsHeading, playerResults);

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
      item.append(rank, standingName, score);
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
    if (viewerHasSubmitted) {
      const progress = document.createElement("p");
      progress.className = "submission-progress";
      progress.setAttribute("aria-live", "polite");
      const playerList = document.createElement("ul");
      playerList.className = "submission-player-list progress-chip-list";
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
    waiting.textContent = "Submit your completion when you’re ready.";
    screen.append(waiting);
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
    label.textContent = "Your completion";
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
    submit.textContent = submission.isSubmitting ? "Submitting…" : "Submit completion";
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
