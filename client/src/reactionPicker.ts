import { catalogue, categories, findReactions, quickReactions } from "./reactionCatalogue.ts";
import { createIcon } from "./ui/icon.ts";

export function attachReactionPicker(row: HTMLElement, trigger: HTMLButtonElement, select: (emoji: string) => void): void {
  function open() {
    if (!row.isConnected || row.querySelector("dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.className = "reaction-picker";
    dialog.setAttribute("aria-label", "Choose a reaction");
    const choices = document.createElement("div");
    function button(label: string, action: () => void) {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = label;
      node.addEventListener("click", action);
      return node;
    }
    function choose(emoji: string) {
      dialog.close();
      select(emoji);
    }
    function emojiButton(emoji: string, name: string) {
      const node = button(emoji, () => choose(emoji));
      node.setAttribute("aria-label", name);
      return node;
    }
    function expanded() {
      dialog.className = "reaction-picker expanded-picker";
      dialog.style.left = "";
      dialog.style.top = "";
      dialog.setAttribute("aria-label", "Choose an emoji");
      const heading = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "Choose an emoji";
      const close = button("", () => dialog.close());
      close.setAttribute("aria-label", "Close emoji picker");
      close.append(createIcon("close"));
      heading.append(title, close);
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = "Search emoji";
      search.setAttribute("aria-label", "Search emoji");
      const nav = document.createElement("div");
      nav.className = "emoji-categories";
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      let category = categories[0]!;
      function update() {
        for (const control of Array.from(nav.children)) control.setAttribute("aria-pressed", String(control.textContent === category));
        const matches = findReactions(category, search.value);
        grid.replaceChildren(...matches.map(([emoji, name]) => emojiButton(emoji, name)));
        if (!matches.length) grid.textContent = "No matching emoji.";
        grid.scrollTop = 0;
      }
      for (const name of categories) nav.append(button(name, () => { category = name; update(); }));
      search.addEventListener("input", update);
      dialog.replaceChildren(heading, search, nav, grid);
      update();
      search.focus();
    }
    choices.className = "quick-reactions";
    for (const emoji of quickReactions) {
      const entry = Object.values(catalogue).flat().find(([value]) => value === emoji)!;
      choices.append(emojiButton(emoji, entry[1]));
    }
    const more = button("", expanded);
    more.setAttribute("aria-label", "Browse all emoji");
    more.append(createIcon("smile-plus"));
    choices.append(more);
    dialog.append(choices);
    dialog.addEventListener("click", event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (!document.activeElement || document.activeElement === document.body) trigger.focus({ preventScroll: true });
    }, { once: true });
    row.append(dialog);
    dialog.showModal();
    const anchor = trigger.getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    const viewport = document.documentElement;
    dialog.style.left = Math.max(4, Math.min(anchor.right - bounds.width, viewport.clientWidth - bounds.width - 4)) + "px";
    dialog.style.top = Math.max(4, Math.min(anchor.top >= bounds.height + 4 ? anchor.top - bounds.height : anchor.bottom, viewport.clientHeight - bounds.height - 4)) + "px";
  }
  trigger.addEventListener("click", open);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removal: MutationObserver | undefined;
  let startX = 0, startY = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    removal?.disconnect();
    removal = undefined;
  };
  row.addEventListener("pointerdown", event => {
    cancel();
    if (event.pointerType !== "touch" || (event.target as Element).closest("button,dialog")) return;
    startX = event.clientX;
    startY = event.clientY;
    removal = new MutationObserver(() => { if (!row.isConnected) cancel(); });
    removal.observe(row.ownerDocument.body, { childList: true, subtree: true });
    timer = setTimeout(() => {
      removal?.disconnect();
      open();
    }, 500);
  });
  row.addEventListener("pointermove", event => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });
  for (const type of ["pointercancel", "pointerup", "pointerleave"]) row.addEventListener(type, cancel);
  row.addEventListener("contextmenu", event => { if (timer && !(event.target as Element).closest("button,dialog")) event.preventDefault(); });
}
