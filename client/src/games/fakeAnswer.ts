export interface FakeAnswerPublicState {
  phase: "question";
  currentRound: number;
  totalRounds: number;
  question: {
    id: string;
    text: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFakeAnswerPublicState(
  value: unknown,
): value is FakeAnswerPublicState {
  if (!isRecord(value) || !isRecord(value.question)) {
    return false;
  }

  return (
    value.phase === "question" &&
    typeof value.currentRound === "number" &&
    typeof value.totalRounds === "number" &&
    typeof value.question.id === "string" &&
    typeof value.question.text === "string"
  );
}

export function renderFakeAnswerGame(publicState: unknown): HTMLElement {
  const screen = document.createElement("section");
  screen.className = "app-screen question-screen";

  if (!isFakeAnswerPublicState(publicState)) {
    const title = document.createElement("h1");
    title.textContent = "Game starting";
    screen.append(title);
    return screen;
  }

  const title = document.createElement("h1");
  title.textContent = "Question";
  const round = document.createElement("p");
  round.className = "round-counter";
  round.textContent = `Round ${publicState.currentRound} / ${publicState.totalRounds}`;
  const question = document.createElement("p");
  question.className = "question-text";
  question.textContent = publicState.question.text;
  screen.append(title, round, question);
  return screen;
}
