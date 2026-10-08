export interface FakeAnswerPublicState {
  phase: "question" | "answer-submission" | "reveal" | "voting" | "results";
  currentRound: number;
  totalRounds: number;
  prompt: {
    id: string;
    text: string;
  } | null;
  submissionCount: number;
  playerCount: number;
}

export interface FakeAnswerSubmissionViewState {
  hasSubmitted: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
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

  return (
    value.phase === "question" &&
    typeof value.currentRound === "number" &&
    typeof value.totalRounds === "number" &&
    typeof value.submissionCount === "number" &&
    typeof value.playerCount === "number" &&
    promptIsValid
  ) || (
    (value.phase === "answer-submission" ||
      value.phase === "reveal" ||
      value.phase === "voting" ||
      value.phase === "results") &&
    typeof value.currentRound === "number" &&
    typeof value.totalRounds === "number" &&
    typeof value.submissionCount === "number" &&
    typeof value.playerCount === "number" &&
    promptIsValid
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

export function renderFakeAnswerGame(
  publicState: unknown,
  submission: FakeAnswerSubmissionViewState,
  onSubmit: (completion: string) => void,
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
  title.textContent =
    publicState.phase === "reveal" ? "All answers submitted" : "Question";
  const round = document.createElement("p");
  round.className = "round-counter";
  round.textContent = `Round ${publicState.currentRound} / ${publicState.totalRounds}`;
  screen.append(title, round);

  if (publicState.phase === "reveal") {
    const waiting = document.createElement("p");
    waiting.className = "screen-description";
    waiting.textContent = "Waiting for the next phase.";
    screen.append(waiting);
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

  if (submission.errorMessage) {
    const error = document.createElement("p");
    error.className = "error-message";
    error.setAttribute("role", "alert");
    error.textContent = submission.errorMessage;
    screen.append(error);
  }

  return screen;
}
