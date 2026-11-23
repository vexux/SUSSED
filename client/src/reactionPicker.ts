const quick = ["👍", "❤️", "😂", "😮", "😭", "🔥"];
const emojiPattern = (() => {
  try { return new RegExp("^\\p{RGI_Emoji}$", "v"); }
  catch { return /^\p{Extended_Pictographic}\uFE0F?$/u; }
})();
let catalog: string[] | undefined;

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
    function show(values: string[]) {
      choices.replaceChildren(...values.map(emoji => button(emoji, () => choose(emoji))));
    }
    show(quick);
    const more = button("More", () => {
      catalog ??= Array.from({ length: 0x1fb00 - 0x2000 }, (_, i) => String.fromCodePoint(0x2000 + i))
        .filter(char => /\p{Extended_Pictographic}/u.test(char) && /\p{Assigned}/u.test(char))
        .map(char => /\p{Emoji_Presentation}/u.test(char) ? char : char + "\uFE0F")
        .filter(char => emojiPattern.test(char));
      show(catalog);
      more.remove();
      const input = document.createElement("input");
      input.placeholder = "Enter an emoji";
      input.setAttribute("aria-label", "Emoji from your keyboard");
      input.maxLength = 32;
      const apply = button("Use emoji", () => choose(input.value));
      apply.disabled = true;
      input.addEventListener("input", () => { apply.disabled = !emojiPattern.test(input.value); });
      dialog.prepend(input, apply);
      input.focus();
    });
    dialog.append(choices, more, button("Close", () => dialog.close()));
    dialog.addEventListener("click", event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    dialog.addEventListener("close", () => { dialog.remove(); trigger.focus(); }, { once: true });
    row.append(dialog);
    dialog.showModal();
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
