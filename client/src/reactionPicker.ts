import { rememberReaction, recentReactions } from "./recentReactions.ts";
import type { Category } from "./reactionCatalogue.ts";
import { createIcon, type IconName } from "./ui/icon.ts";

const quickReactions = [
  ["👍", "Thumbs up"], ["❤️", "Red heart"], ["😂", "Face with tears of joy"],
  ["😮", "Face with open mouth"], ["😭", "Loudly crying face"], ["🔥", "Fire"],
];
const categoryIcons: Record<Category, IconName> = {
  "Recently Used": "clock", "Smileys & People": "smile", "Animals & Nature": "leaf", "Food & Drink": "utensils",
  "Travel & Places": "globe", Activities: "game", Objects: "bulb", Symbols: "heart", Flags: "flag",
};


export function attachReactionPicker(row: HTMLElement, trigger: HTMLButtonElement, select: (emoji: string) => void, playerId?: string | null): void {
  let temporaryRecents: string[] = [];
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
      if (playerId) rememberReaction(playerId, emoji);
      else temporaryRecents = [emoji, ...temporaryRecents.filter(value => value !== emoji)].slice(0, 24);
      dialog.close();
      select(emoji);
    }
    function emojiButton(emoji: string, name: string) {
      const node = button(emoji, () => choose(emoji));
      node.setAttribute("aria-label", name);
      return node;
    }
    async function expanded() {
      more.disabled = true;
      let data: typeof import("./reactionCatalogue.ts");
      try { data = await import("./reactionCatalogue.ts"); }
      catch {
        more.disabled = false;
        more.setAttribute("aria-label", "Emoji catalogue could not load. Retry");
        more.title = "Emoji catalogue could not load. Retry";
        return;
      }
      if (!dialog.open) return;
      const { catalogue, categories, entries, findReactions } = data;
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
      nav.setAttribute("role", "navigation");
      nav.setAttribute("aria-label", "Emoji categories");
      const scroller = document.createElement("div");
      scroller.className = "emoji-scroll";
      const browse = document.createElement("div");
      const recent = playerId ? recentReactions(playerId, emoji => catalogue.has(emoji)) : temporaryRecents;
      const sections = new Map<Category, HTMLElement>();
      const controls = new Map<Category, HTMLButtonElement>();
      let active: Category | undefined;
      function mark(name: Category) {
        if (active === name) return;
        active = name;
        for (const [category, control] of controls) control.setAttribute("aria-pressed", String(category === name));
        const tab = controls.get(name);
        if (tab && tab.offsetLeft < nav.scrollLeft) nav.scrollLeft = tab.offsetLeft;
        else if (tab && tab.offsetLeft + tab.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = tab.offsetLeft + tab.offsetWidth - nav.clientWidth;
      }
      function jump(name: Category) {
        const section = sections.get(name);
        if (section) scroller.scrollTop = section.offsetTop;
        mark(name);
      }
      for (const name of categories) {
        const values = name === "Recently Used" ? recent.map(emoji => catalogue.get(emoji)!) : entries.filter(entry => entry.category === name);
        if (!values.length) continue;
        const section = document.createElement("section");
        const label = document.createElement("h3");
        label.textContent = name;
        const grid = document.createElement("div");
        grid.className = "emoji-grid";
        grid.append(...values.map(entry => emojiButton(entry.emoji, entry.name)));
        section.append(label, grid);
        browse.append(section);
        const control = button("", () => jump(name));
        control.append(createIcon(categoryIcons[name]));
        control.setAttribute("aria-label", name);
        control.title = name;
        nav.append(control);
        controls.set(name, control);
        sections.set(name, section);
      }
      scroller.append(browse);
      scroller.addEventListener("scroll", () => {
        if (search.value.trim()) return;
        let visible = sections.keys().next().value;
        for (const [name, section] of sections) {
          if (section.offsetTop > scroller.scrollTop + 2) break;
          visible = name;
        }
        if (visible) mark(visible);
      });
      const clear = button("", () => { search.value = ""; update(); search.focus(); });
      clear.setAttribute("aria-label", "Clear emoji search");
      clear.append(createIcon("close"));
      clear.hidden = true;
      const field = document.createElement("div");
      field.className = "emoji-search";
      field.append(search, clear);
      function update() {
        const term = search.value.trim();
        clear.hidden = !search.value;
        nav.hidden = Boolean(term);
        if (!term) {
          scroller.replaceChildren(browse);
          if (active) jump(active);
          return;
        }
        const results = document.createElement("div");
        results.className = "emoji-grid";
        const matches = findReactions(term);
        results.append(...matches.map(entry => emojiButton(entry.emoji, entry.name)));
        if (!matches.length) results.textContent = "No matching emoji.";
        scroller.replaceChildren(results);
        scroller.scrollTop = 0;
      }
      search.addEventListener("input", update);
      dialog.replaceChildren(heading, field, nav, scroller);
      mark(recent.length ? "Recently Used" : "Smileys & People");
      search.focus();
    }
    choices.className = "quick-reactions";
    for (const [emoji, name] of quickReactions) choices.append(emojiButton(emoji!, name!));
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
