export interface FakeAnswerOption {
  id: string;
  completion: string;
}

export interface FakeAnswerResultOption {
  id: string;
  completion: string;
  authorId: string | null;
  authorName: string | null;
  isCorrect: boolean;
}

export interface FakeAnswerResultPlayer {
  playerId: string;
  name: string;
  submittedCompletion: string;
  voteOptionId: string;
  voteCompletion: string;
  voteCorrect: boolean;
  roundPoints: number;
  totalScore: number;
}

export interface FakeAnswerStanding {
  playerId: string;
  name: string;
  totalScore: number;
  rank: number;
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
  options?: FakeAnswerOption[];
  voteCount?: number;
  isFinalRound?: boolean;
  continueReadyCount?: number;
  continuePlayerCount?: number;
  viewerReadyToContinue?: boolean;
  results?: FakeAnswerResults;
}

export interface FakeAnswerViewState {
  hasSubmitted: boolean;
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
          Object.keys(option).sort().join(",") === "completion,id",
      ));
  const phaseIsValid =
    value.phase === "question" ||
    value.phase === "answer-submission" ||
    value.phase === "reveal" ||
    value.phase === "voting" ||
    value.phase === "waiting-for-results" ||
    value.phase === "results";
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
          typeof option.isCorrect === "boolean",
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
      (value.isFinalRound === true ||
        (typeof value.continueReadyCount === "number" &&
          typeof value.continuePlayerCount === "number" &&
          typeof value.viewerReadyToContinue === "boolean")));

  return (
    phaseIsValid &&
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
        value.options.length >= 2 &&
        value.options.length === value.playerCount)) &&
    ((value.phase !== "voting" && value.phase !== "waiting-for-results") ||
      typeof value.voteCount === "number")
  );
}

export function updateFakeAnswerProgress(
  root: ParentNode,
  publicState: unknown,
): boolean {
  if (
    !isFakeAnswerPublicState(publicState) ||
    publicState.phase !== "answer-submission"
  ) {
    return false;
  }

  const progress = root.querySelector<HTMLElement>(".submission-progress");
  if (!progress) {
    return false;
  }

  progress.textContent =
    `${publicState.submissionCount} / ${publicState.playerCount} players submitted`;
  return true;
}

export function updateFakeAnswerVoteProgress(
  root: ParentNode,
  publicState: unknown,
): boolean {
  if (
    !isFakeAnswerPublicState(publicState) ||
    publicState.phase !== "voting" ||
    typeof publicState.voteCount !== "number"
  ) {
    return false;
  }

  const progress = root.querySelector<HTMLElement>(".vote-progress");
  if (!progress) {
    return false;
  }
  progress.textContent =
    `${publicState.voteCount} / ${publicState.playerCount} players voted`;
  return true;
}

export function renderFakeAnswerGame(
  publicState: unknown,
  submission: FakeAnswerViewState,
  onSubmit: (completion: string) => void,
  onSelectVote: (optionId: string) => void,
  onVote: (optionId: string) => void,
  onContinue: () => void,
  onReturnToLobby: () => void,
): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "app-screen question-screen";

  if (!isFakeAnswerPublicState(publicState)) {
    const title = document.createElement("h1");
    title.textContent = "Game starting";
    screen.append(title);
    return screen;
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
  screen.append(title, round);

  if (publicState.phase === "results" && publicState.results) {
    if (publicState.prompt) {
      const prompt = document.createElement("p");
      prompt.className = "question-text";
      prompt.textContent = publicState.prompt.text;
      screen.append(prompt);
    }
    const correctHeading = document.createElement("h2");
    correctHeading.textContent = "Real completion";
    const correct = document.createElement("p");
    correct.className = "correct-completion";
    correct.textContent = publicState.results.correctCompletion;
    screen.append(correctHeading, correct);

    const optionsHeading = document.createElement("h2");
    optionsHeading.textContent = "All completions";
    const options = document.createElement("ul");
    options.className = "revealed-options";
    for (const option of publicState.results.options) {
        const item = document.createElement("li");
        const author = option.isCorrect
          ? "Real answer"
          : `Fake answer by ${option.authorName}`;
        item.textContent = `${option.completion} — ${author}${option.isCorrect ? " (correct)" : ""}`;
        options.append(item);
    }
    screen.append(optionsHeading, options);

    const playerResultsHeading = document.createElement("h2");
    playerResultsHeading.textContent = "Votes and round points";
    const playerResults = document.createElement("ul");
    playerResults.className = "revealed-options";
    for (const player of publicState.results.players) {
        const item = document.createElement("li");
        item.textContent =
          `${player.name}: voted for “${player.voteCompletion}” ` +
          `(${player.voteCorrect ? "correct" : "incorrect"}); submitted ` +
          `“${player.submittedCompletion}”; +${player.roundPoints} ` +
          `point${player.roundPoints === 1 ? "" : "s"}, ` +
          `${player.totalScore} total`;
        playerResults.append(item);
    }
    screen.append(playerResultsHeading, playerResults);

    const standingsHeading = document.createElement("h2");
    standingsHeading.textContent = publicState.isFinalRound
      ? "Final standings — total scores"
      : "Standings — total scores";
    const standings = document.createElement("ol");
    standings.className = "revealed-options";
    for (const standing of publicState.results.standings) {
        const item = document.createElement("li");
        item.textContent =
          `#${standing.rank} ${standing.name} — ${standing.totalScore} ` +
          `point${standing.totalScore === 1 ? "" : "s"}`;
        standings.append(item);
    }
    screen.append(standingsHeading, standings);

    if (publicState.isFinalRound) {
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
        waiting.textContent =
          "Waiting for the host to return everyone to the lobby…";
        screen.append(waiting);
      }
      if (submission.returnToLobbyError) {
        const error = document.createElement("p");
        error.className = "error-message";
        error.setAttribute("role", "alert");
        error.textContent = submission.returnToLobbyError;
        screen.append(error);
      }
    } else {
      const continueProgress = document.createElement("p");
      continueProgress.className = "continue-progress";
      continueProgress.textContent =
        `${publicState.continueReadyCount} / ${publicState.continuePlayerCount} players ready to continue`;
      screen.append(continueProgress);

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
    progress.textContent =
      `${publicState.voteCount} / ${publicState.playerCount} players voted`;
    screen.append(waiting, progress);
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
    preparing.textContent = "Get ready to invent a believable completion…";
    screen.append(preparing);
    return screen;
  }

  if (publicState.phase === "answer-submission") {
    const progress = document.createElement("p");
    progress.className = "submission-progress";
    progress.textContent =
      `${publicState.submissionCount} / ${publicState.playerCount} players submitted`;
    screen.append(progress);

    if (submission.hasSubmitted) {
      const submitted = document.createElement("p");
      submitted.className = "status-message";
      submitted.textContent = "Your completion has been submitted.";
      screen.append(submitted);
      return screen;
    }

    const form = document.createElement("form");
    form.className = "submission-form";
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = "fake-completion";
    label.textContent = "Your believable completion";
    const input = document.createElement("input");
    input.className = "text-input";
    input.id = "fake-completion";
    input.name = "completion";
    input.type = "text";
    input.maxLength = 160;
    input.required = true;
    input.autocomplete = "off";
    input.disabled = submission.isSubmitting;
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
      item.textContent = option.completion;
      revealedOptions.append(item);
    }
    screen.append(revealedOptions);
    return screen;
  }

  if (publicState.phase === "voting") {
    const progress = document.createElement("p");
    progress.className = "vote-progress";
    progress.textContent =
      `${publicState.voteCount} / ${publicState.playerCount} players voted`;
    screen.append(progress);

    if (submission.hasVoted) {
      const waiting = document.createElement("p");
      waiting.className = "status-message";
      waiting.textContent = "Your vote has been recorded. Waiting for other players…";
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
      input.addEventListener("change", () => onSelectVote(option.id));
      const answer = document.createElement("span");
      answer.textContent = option.completion;
      label.append(input, answer);
      form.append(label);
    }
    const submit = document.createElement("button");
    submit.className = "primary-button";
    submit.type = "submit";
    submit.disabled = submission.isVoting || submission.selectedOptionId === null;
    submit.textContent = submission.isVoting ? "Submitting vote…" : "Submit vote";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submission.selectedOptionId) {
        onVote(submission.selectedOptionId);
      }
    });
    screen.append(form);
  }

  if (submission.submissionError || submission.voteError) {
    const error = document.createElement("p");
    error.className = "error-message";
    error.setAttribute("role", "alert");
    error.textContent = submission.submissionError ?? submission.voteError ?? "";
    screen.append(error);
  }

  return screen;
}
