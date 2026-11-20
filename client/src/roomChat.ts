export interface RoomChatMessage {
  id: string;
  type: "player" | "system";
  senderName: string | null;
  text: string;
  createdAt: string;
}

export interface RoomChatState {
  expanded: boolean;
  messages: RoomChatMessage[];
  draft: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  cursor: string | null;
  sending: boolean;
  canSend: boolean;
}

export interface RoomChatActions {
  onToggleExpanded(): void;
  onDraftChange(draft: string): void;
  onSendMessage(text: string): void;
  onLoadOlder(cursor: string): void;
}

export const ROOM_CHAT_MAX_LENGTH = 200;

export function createInitialRoomChatState(): RoomChatState {
  return {
    expanded: false,
    messages: [],
    draft: "",
    hasOlder: false,
    loadingOlder: false,
    cursor: null,
    sending: false,
    canSend: false,
  };
}

export function canSubmitRoomChatMessage(state: Pick<RoomChatState, "draft" | "sending" | "canSend">): boolean {
  const text = state.draft.trim();
  return state.canSend && !state.sending && text.length > 0 && text.length <= ROOM_CHAT_MAX_LENGTH;
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

function localTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function renderMessage(message: RoomChatMessage): HTMLElement {
  if (message.type === "system") {
    const item = element("li", "room-chat-system-message", message.text);
    item.setAttribute("aria-label", `System message: ${message.text}`);
    return item;
  }
  const item = element("li", "room-chat-message");
  const avatar = element("span", "room-chat-avatar", initials(message.senderName ?? "?"));
  avatar.setAttribute("aria-hidden", "true");
  const body = element("div", "room-chat-message-body");
  const metadata = element("div", "room-chat-message-meta");
  metadata.append(element("span", "room-chat-sender", message.senderName ?? "Player"));
  metadata.append(element("time", "room-chat-time", localTime(message.createdAt)));
  const text = element("p", "room-chat-message-text", message.text);
  body.append(metadata, text);
  item.append(avatar, body);
  return item;
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
  toggle.append(element("span", "room-chat-count", `${state.messages.length} messages`));
  const chevron = element("span", "room-chat-chevron", "⌄");
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(chevron);
  toggle.addEventListener("click", actions.onToggleExpanded);
  heading.append(toggle);

  const list = element("ol", "room-chat-message-list");
  list.setAttribute("aria-live", "polite");
  const visibleMessages = state.expanded ? state.messages.slice(-50) : state.messages.slice(-3);
  for (const message of visibleMessages) list.append(renderMessage(message));
  if (visibleMessages.length === 0) list.append(element("li", "room-chat-empty", "No messages yet."));
  if (state.expanded) {
    list.classList.add("is-expanded");
    list.addEventListener("scroll", () => {
      if (list.scrollTop <= 24 && state.hasOlder && !state.loadingOlder && state.cursor) actions.onLoadOlder(state.cursor);
    });
  }

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
  const send = element("button", "primary-button room-chat-send", "Send");
  send.type = "submit";
  send.disabled = !canSubmitRoomChatMessage(state);
  send.setAttribute("aria-label", "Send room chat message");
  input.addEventListener("input", () => {
    actions.onDraftChange(input.value);
    send.disabled = !canSubmitRoomChatMessage(state);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (canSubmitRoomChatMessage(state)) actions.onSendMessage(state.draft.trim());
  });
  form.append(input, send);
  panel.append(heading, list, form);
  return panel;
}

export function prependRoomChatMessages(list: HTMLElement, messages: HTMLElement[]): void {
  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;
  for (const message of messages.reverse()) list.insertBefore(message, list.firstElementChild);
  list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
}
