import { createIcon } from "./ui/icon.ts";
export interface RoomChatMessage {
  id: string;
  type: "player" | "system";
  senderId?: string;
  senderName: string | null;
  text: string;
  createdAt: string;
}

export interface RoomChatState {
  expanded: boolean;
  messages: RoomChatMessage[];
  draft: string;
  messageCount: number;
  historyLoaded: boolean;
  historyLoading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  cursor: string | null;
  sending: boolean;
  canSend: boolean;
  error: string | null;
  roomId: string | null;
}

export interface RoomChatActions {
  playerTarget?(id: string): ((id: string, anchorId: string) => void) | undefined;
  onToggleExpanded(): void;
  onDraftChange(draft: string): void;
  onSendMessage(text: string): void;
  onLoadOlder(cursor: string): void;
}

export interface RoomChatHistoryPage {
  messages: RoomChatMessage[];
  cursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export const ROOM_CHAT_MAX_LENGTH = 200;

export function createInitialRoomChatState(): RoomChatState {
  return {
    expanded: false,
    messages: [],
    draft: "",
    messageCount: 0,
    historyLoaded: false,
    historyLoading: false,
    hasOlder: false,
    loadingOlder: false,
    cursor: null,
    sending: false,
    canSend: false,
    error: null,
    roomId: null,
  };
}

export function canSubmitRoomChatMessage(state: Pick<RoomChatState, "draft" | "sending" | "canSend">): boolean {
  const text = state.draft.trim();
  return state.canSend && !state.sending && text.length > 0 && text.length <= ROOM_CHAT_MAX_LENGTH;
}

export function mergeRoomChatMessages(
  current: RoomChatMessage[],
  incoming: RoomChatMessage[],
): RoomChatMessage[] {
  const messages = new Map<string, RoomChatMessage>();
  for (const message of [...current, ...incoming]) messages.set(message.id, message);
  return [...messages.values()].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id)
  );
}

export function addRoomChatMessage(state: RoomChatState, message: RoomChatMessage): boolean {
  const merged = mergeRoomChatMessages(state.messages, [message]);
  if (merged.length === state.messages.length) return false;
  state.messages = merged;
  state.messageCount = Math.max(state.messageCount + 1, merged.length);
  return true;
}

export function applyRoomChatHistoryPage(
  state: RoomChatState,
  page: RoomChatHistoryPage,
): void {
  state.messages = mergeRoomChatMessages(state.messages, page.messages);
  state.messageCount = Math.max(state.messageCount, page.totalCount);
  state.cursor = page.cursor;
  state.hasOlder = page.hasMore;
  state.historyLoaded = true;
  state.historyLoading = false;
  state.loadingOlder = false;
  state.error = null;
}

export function settleRoomChatSend(
  state: RoomChatState,
  text: string,
  errorMessage: string | null,
): boolean {
  state.sending = false;
  if (errorMessage) {
    state.error = errorMessage;
    return false;
  }
  if (state.draft.trim() === text) state.draft = "";
  state.error = null;
  return true;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
function localTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

function renderMessage(message: RoomChatMessage, actions: RoomChatActions): HTMLElement {
  if (message.type === "system") {
    const item = element("li", "room-chat-system-message", message.text);
    item.dataset.messageId = message.id;
    item.setAttribute("aria-label", `System message: ${message.text}`);
    return item;
  }
  const item = element("li", "room-chat-message");
  item.dataset.messageId = message.id;
  const senderId = message.senderId;
  const open = senderId && actions.playerTarget?.(senderId);
  function senderControl(className: string, text: string) {
    if (!open || !senderId) return element("span", className, text);
    const button = element("button", className + " chat-player-trigger", text);
    button.type = "button";
    button.id = className + "-" + message.id;
    button.setAttribute("aria-label", "Open player card for " + message.senderName);
    button.addEventListener("click", () => open(senderId, button.id));
    return button;
  }
  const avatar = senderControl("room-chat-avatar", initials(message.senderName ?? "?"));
  if (!open) avatar.setAttribute("aria-hidden", "true");
  const body = element("div", "room-chat-message-body");
  const metadata = element("div", "room-chat-message-meta");
  metadata.append(senderControl("room-chat-sender", message.senderName ?? "Player"));
  metadata.append(element("time", "room-chat-time", localTime(message.createdAt)));
  const text = element("p", "room-chat-message-text", message.text);
  body.append(metadata, text);
  item.append(avatar, body);
  return item;
}

function chatCount(state: RoomChatState): string {
  return state.historyLoaded ? `${state.messageCount} ${state.messageCount === 1 ? "message" : "messages"}` : `${state.messages.length} loaded`;
}

export function renderRoomChat(state: RoomChatState, actions: RoomChatActions): HTMLElement {
  const panel = element("section", "room-chat lobby-panel");
  panel.setAttribute("aria-label", "Room chat");
  const heading = element("div", "room-chat-heading");
  const toggle = element("button", "room-chat-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(state.expanded));
  toggle.setAttribute("aria-label", state.expanded ? "Collapse room chat" : "Expand room chat");
  toggle.append(element("span", "lobby-panel-title", "Room chat"));
  const count = element("span", "room-chat-count", chatCount(state));
  count.id = "room-chat-count";
  toggle.setAttribute("aria-describedby", count.id);
  toggle.append(count);
  const sizeIcon = createIcon(state.expanded ? "collapse" : "expand");
  sizeIcon.classList.add("room-chat-size-icon");
  sizeIcon.setAttribute("aria-hidden", "true");
  toggle.append(sizeIcon);
  toggle.addEventListener("click", actions.onToggleExpanded);
  heading.append(toggle);

  const list = element("ol", "room-chat-message-list");
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-label", "Message history");
  list.tabIndex = 0;
  const visibleMessages = state.messages;
  for (const message of visibleMessages) list.append(renderMessage(message, actions));
  if (visibleMessages.length === 0) list.append(element("li", "room-chat-empty", state.historyLoading ? "Loading messages…" : "No messages yet."));
  if (state.loadingOlder) list.append(element("li", "room-chat-loading", "Loading earlier messages…"));
  if (state.expanded) list.classList.add("is-expanded");
  list.addEventListener("scroll", () => {
    if (list.scrollTop <= 24 && state.hasOlder && !state.loadingOlder && state.cursor) actions.onLoadOlder(state.cursor);
  });

  const form = element("form", "room-chat-composer");
  const input = element("input", "room-chat-input");
  input.id = "room-chat-draft";
  input.type = "text";
  input.name = "roomMessage";
  input.placeholder = "Write a message...";
  input.autocomplete = "off";
  input.maxLength = ROOM_CHAT_MAX_LENGTH;
  input.value = state.draft;
  input.setAttribute("aria-label", "Write a room chat message");
  const send = element("button", "primary-button room-chat-send");
  send.append(createIcon("send"));
  send.type = "submit";
  send.disabled = !canSubmitRoomChatMessage(state);
  send.setAttribute("aria-label", "Send room chat message");
  input.addEventListener("input", () => {
    actions.onDraftChange(input.value);
    const currentSend = input.parentElement?.querySelector<HTMLButtonElement>(".room-chat-send");
    if (currentSend) currentSend.disabled = !canSubmitRoomChatMessage(state);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (canSubmitRoomChatMessage(state)) actions.onSendMessage(state.draft.trim());
  });
  form.append(input, send);
  panel.append(heading, list);
  if (state.error) {
    const error = element("p", "room-chat-error", state.error);
    error.setAttribute("role", "alert");
    panel.append(error);
  }
  panel.append(form);
  return panel;
}

export function prependRoomChatMessages(list: HTMLElement, messages: HTMLElement[]): void {
  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;
  for (const message of [...messages].reverse()) list.insertBefore(message, list.firstElementChild);
  list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
}

export function updateRoomChatPanelMessages(
  panel: HTMLElement,
  state: RoomChatState,
  actions: RoomChatActions,
  mode: "append" | "prepend" | "replace" = "append",
): void {
  const currentList = panel.querySelector<HTMLOListElement>(".room-chat-message-list");
  if (!currentList) return;
  const nextPanel = renderRoomChat(state, actions);
  const nextList = nextPanel.querySelector<HTMLOListElement>(".room-chat-message-list");
  if (!nextList) return;
  const nextItems = Array.from(nextList.children) as HTMLElement[];
  if (mode === "prepend") {
    currentList.querySelector(".room-chat-loading")?.remove();
    const existingIds = new Set(Array.from(currentList.children, (item) => (item as HTMLElement).dataset.messageId));
    prependRoomChatMessages(currentList, nextItems.filter((item) => !existingIds.has(item.dataset.messageId)));
  } else {
    const previousTop = currentList.scrollTop;
    const wasNearBottom = currentList.scrollHeight - currentList.scrollTop - currentList.clientHeight <= 28;
    currentList.replaceChildren(...nextItems);
    if (wasNearBottom) currentList.scrollTop = currentList.scrollHeight;
    else currentList.scrollTop = previousTop;
  }
  const count = panel.querySelector<HTMLElement>(".room-chat-count");
  if (count) count.textContent = chatCount(state);
  const currentError = panel.querySelector<HTMLElement>(".room-chat-error");
  const nextError = nextPanel.querySelector<HTMLElement>(".room-chat-error");
  if (currentError && nextError) currentError.textContent = nextError.textContent;
  else if (!currentError && nextError) panel.insertBefore(nextError, panel.querySelector(".room-chat-composer"));
  else currentError?.remove();
}
