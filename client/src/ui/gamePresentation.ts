export interface PresentationPlayer {
  playerId: string;
  name: string;
}

export interface PresentationAnswerOption {
  id: string;
  completion: string;
  isOwnAnswer?: boolean;
}

export interface PresentationStanding extends PresentationPlayer {
  rank: number;
  totalScore: number;
}

export function appendGameHeader(
  screen: HTMLElement,
  gameName: string,
  titleText: string,
  currentRound: number,
  totalRounds: number,
): void {
  const game = document.createElement("p");
  game.className = "screen-description";
  game.textContent = gameName;
  const title = document.createElement("h1");
  title.textContent = titleText;
  const round = document.createElement("p");
  round.className = "round-counter";
  round.textContent = `Round ${currentRound} of ${totalRounds}`;
  screen.append(game, title, round);
}

export function createQuestionText(text: string): HTMLParagraphElement {
  const prompt = document.createElement("p");
  prompt.className = "question-text";
  prompt.textContent = text;
  return prompt;
}

export function createStatusMessage(
  text: string,
  className = "status-message",
): HTMLParagraphElement {
  const status = document.createElement("p");
  status.className = className;
  status.textContent = text;
  return status;
}

export function createProgressChipList<T extends PresentationPlayer>(
  players: T[],
  statusFor: (player: T) => string,
  className = "progress-chip-list",
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = className;
  replaceProgressChipList(list, players, statusFor);
  return list;
}

export function replaceProgressChipList<T extends PresentationPlayer>(
  list: HTMLUListElement,
  players: T[],
  statusFor: (player: T) => string,
): void {
  list.replaceChildren();
  for (const player of players) {
    const item = document.createElement("li");
    item.className = "progress-chip";
    item.dataset.playerId = player.playerId;
    item.textContent = statusFor(player);
    list.append(item);
  }
}

export function createSubmissionProgress(
  count: number,
  playerCount: number,
  players: Array<PresentationPlayer & { submitted: boolean }>,
  currentPlayerId: string | null,
): HTMLElement[] {
  const progress = document.createElement("p");
  progress.className = "submission-progress";
  progress.setAttribute("aria-live", "polite");
  progress.textContent = `${count} of ${playerCount} answers submitted`;
  const list = createProgressChipList(players, (player) => {
    const label = player.submitted ? "Submitted" : "Waiting";
    return player.playerId === currentPlayerId
      ? `You · ${label}`
      : `${player.name} · ${label}`;
  }, "submission-player-list progress-chip-list");
  for (const item of Array.from(list.children)) {
    const player = players.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
    if (player?.submitted) item.classList.add("progress-chip-done");
  }
  return [progress, list];
}

export function createVoteProgress(
  count: number,
  playerCount: number,
  players: Array<PresentationPlayer & { voted: boolean }>,
  currentPlayerId: string | null,
): HTMLElement[] {
  const progress = document.createElement("p");
  progress.className = "vote-progress";
  progress.textContent = `${count} of ${playerCount} players voted`;
  const list = createProgressChipList(players, (player) => {
    const label = player.voted ? "Voted" : "Waiting";
    return player.playerId === currentPlayerId
      ? `You · ${label}`
      : `${player.name} · ${label}`;
  }, "vote-player-list progress-chip-list");
  for (const item of Array.from(list.children)) {
    const player = players.find(({ playerId }) => playerId === (item as HTMLLIElement).dataset.playerId);
    if (player?.voted) item.classList.add("progress-chip-done");
  }
  return [progress, list];
}

export function createSubmissionForm(options: {
  inputId: string;
  inputName: string;
  label: string;
  draft: string;
  isSubmitting: boolean;
  onSubmit: (answer: string) => void;
  onDraftChange?: (answer: string) => void;
}): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "submission-form";
  const label = document.createElement("label");
  label.className = "field-label";
  label.htmlFor = options.inputId;
  label.textContent = options.label;
  const input = document.createElement("input");
  input.className = "text-input";
  input.id = options.inputId;
  input.name = options.inputName;
  input.type = "text";
  input.maxLength = 160;
  input.required = true;
  input.autocomplete = "off";
  input.disabled = options.isSubmitting;
  input.value = options.draft;
  if (options.onDraftChange) {
    input.addEventListener("input", () => options.onDraftChange?.(input.value));
  }
  const submit = document.createElement("button");
  submit.className = "primary-button";
  submit.type = "submit";
  submit.disabled = options.isSubmitting;
  submit.textContent = options.isSubmitting ? "Submitting…" : "Submit";
  form.append(label, input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSubmit(input.value);
  });
  return form;
}

export function createVotingForm(options: {
  answers: PresentationAnswerOption[];
  selectedOptionId: string | null;
  isSubmitting: boolean;
  hasVoted?: boolean;
  radioName: string;
  formatAnswer?: (answer: string) => string;
  onSelect: (optionId: string) => void;
  onSubmit: (optionId: string) => void;
}): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "vote-form";
  const selectableCount = options.answers.filter(({ isOwnAnswer }) => !isOwnAnswer).length;
  if (selectableCount < 1) {
    throw new Error("A voting form requires at least one answer from another player.");
  }
  let selectedOptionId = options.selectedOptionId;
  let submit: HTMLButtonElement | null = null;
  for (const option of options.answers) {
    const label = document.createElement("label");
    label.className = "vote-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = options.radioName;
    input.value = option.id;
    input.checked = selectedOptionId === option.id;
    input.disabled = options.isSubmitting || options.hasVoted === true;
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
        options.onSelect(option.id);
        if (submit) {
          submit.disabled = options.isSubmitting || options.hasVoted === true;
        }
      });
    }
    const answer = document.createElement("span");
    answer.textContent = options.formatAnswer?.(option.completion) ?? option.completion;
    label.append(input, answer);
    form.append(label);
  }
  submit = document.createElement("button");
  submit.className = "primary-button";
  submit.type = "submit";
  submit.disabled = options.isSubmitting || options.hasVoted === true || selectedOptionId === null;
  submit.textContent = options.isSubmitting ? "Submitting…" : "Submit";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selectedOptionId && !options.isSubmitting && !options.hasVoted) {
      options.onSubmit(selectedOptionId);
    }
  });
  return form;
}

export function createAnswerResultCard(options: {
  completion: string;
  authorName: string | null;
  voteCount: number;
  voterNames: string[];
  formatAnswer?: (answer: string) => string;
  isCorrect?: boolean;
  voterPrefix?: string;
  noVotesText?: string;
}): HTMLLIElement {
  const isCorrect = options.isCorrect === true;
  const item = document.createElement("li");
  item.className = isCorrect
    ? "result-card result-card-correct real-answer-card"
    : "result-card";
  const answerHeading = document.createElement("div");
  answerHeading.className = "result-card-heading answer-card-main-row";
  const answerContent = document.createElement("div");
  answerContent.className = "answer-card-content";
  if (options.authorName) {
    const author = document.createElement("span");
    author.className = "bluff-author";
    author.textContent = options.authorName;
    const separator = document.createElement("span");
    separator.className = "bluff-author-separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "|";
    answerContent.append(author, separator);
  }
  const answer = document.createElement("span");
  answer.className = "result-answer-text answer-card-answer";
  answer.textContent = options.formatAnswer?.(options.completion) ?? options.completion;
  answerContent.append(answer);
  const voteCount = document.createElement("span");
  voteCount.className = "answer-vote-count";
  voteCount.textContent = `${options.voteCount} vote${options.voteCount === 1 ? "" : "s"}`;
  answerHeading.append(answerContent, voteCount);
  const voterNames = document.createElement("p");
  voterNames.className = "result-detail";
  voterNames.textContent = options.voterNames.length > 0
    ? `${options.voterPrefix ?? "Chosen by"}: ${options.voterNames.join(", ")}`
    : options.noVotesText ?? "No one chose this answer.";
  item.append(answerHeading, voterNames);
  return item;
}

export function createStandingsList(
  standings: PresentationStanding[],
  options: {
    className?: string;
    final?: boolean;
    roundPointsByPlayer?: Map<string, number>;
  } = {},
): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = `result-card-list standings-list${options.className ? ` ${options.className}` : ""}`;
  for (const standing of standings) {
    const item = document.createElement("li");
    item.className = "result-card standing-card";
    item.dataset.playerId = standing.playerId;
    const rank = document.createElement("span");
    rank.className = "standing-rank";
    rank.textContent = `#${standing.rank}`;
    const name = document.createElement("span");
    name.className = "standing-name";
    name.textContent = standing.name;
    const roundPoints = options.roundPointsByPlayer?.get(standing.playerId);
    if (typeof roundPoints === "number") {
      const roundScore = document.createElement("span");
      roundScore.className = roundPoints > 0
        ? "standing-round-score standing-round-score-positive"
        : roundPoints < 0
          ? "standing-round-score standing-round-score-negative"
          : "standing-round-score";
      roundScore.textContent = `${roundPoints >= 0 ? "+" : ""}${roundPoints}`;
      roundScore.setAttribute("aria-label", `Round points: ${roundScore.textContent} points`);
      item.append(rank, name, roundScore);
    } else {
      item.append(rank, name);
    }
    const score = document.createElement("strong");
    score.className = "standing-score";
    score.textContent = `${standing.totalScore} point${standing.totalScore === 1 ? "" : "s"}`;
    item.append(score);
    list.append(item);
  }
  return list;
}

export function appendContinueReadiness(options: {
  screen: HTMLElement;
  readyCount: number;
  playerCount: number;
  players: Array<PresentationPlayer & { ready: boolean }>;
  viewerReady: boolean;
  isContinuing: boolean;
  onContinue: () => void;
  error?: string | null;
}): void {
  const progress = document.createElement("p");
  progress.className = "continue-progress";
  progress.textContent = `${options.readyCount} / ${options.playerCount} players ready to continue`;
  options.screen.append(progress);
  const list = createProgressChipList(options.players, ({ name, ready }) => `${name} · ${ready ? "Ready" : "Waiting"}`, "continue-player-list progress-chip-list");
  options.players.forEach((player, index) => {
    if (player.ready) list.children[index]?.classList.add("progress-chip-done");
  });
  options.screen.append(list);
  if (options.viewerReady) {
    options.screen.append(createStatusMessage("You’re ready. Waiting for the other players…"));
  } else {
    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.disabled = options.isContinuing;
    button.textContent = options.isContinuing ? "Continuing…" : "Continue";
    button.addEventListener("click", options.onContinue);
    options.screen.append(button);
  }
  if (options.error) {
    const error = createStatusMessage(options.error, "error-message");
    error.setAttribute("role", "alert");
    options.screen.append(error);
  }
}

export function appendWinnerPresentation(
  screen: HTMLElement,
  winnerNames: string[],
  scoreText: string,
): void {
  const heading = document.createElement("h2");
  heading.className = "final-winner-heading";
  heading.textContent = winnerNames.length > 1 ? "It's a tie!" : "Winner";
  const names = document.createElement("p");
  names.className = "final-winner-names";
  names.textContent = winnerNames.join(", ");
  const score = document.createElement("p");
  score.className = "final-winner-scores";
  score.textContent = scoreText;
  screen.append(heading, names, score);
}
