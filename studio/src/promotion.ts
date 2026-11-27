declare const __API_ORIGIN__: string;
type Reply = {
  status?: string;
  actionId?: string;
  details?: unknown;
  transactions?: string[];
  error?: string;
};
export function promotionPanel() {
  const panel = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = "Publication workflow";
  const label = document.createElement("label");
  label.textContent = "Publication receipt ";
  const receipts = document.createElement("select");
  label.append(receipts);
  const buttons = document.createElement("div"),
    result = document.createElement("pre");
  result.setAttribute("role", "status");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.hidden = true;
  const controls: HTMLButtonElement[] = [];
  let requestNumber = 0;
  async function run(action: string, confirmation?: string) {
    const n = ++requestNumber;
    confirm.hidden = true;
    result.textContent = "Checking " + action + "…";
    controls.forEach((b) => (b.disabled = true));
    try {
      const response = await fetch(
        __API_ORIGIN__ + "/api/publication-workflow",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            transactionId: receipts.value || undefined,
            confirmation,
          }),
        },
      );
      const r: Reply = await response.json();
      if (n !== requestNumber) return;
      if (!response.ok) throw Error(r.error || "Operation failed");
      if (r.transactions) {
        const previous = receipts.value;
        receipts.replaceChildren(
          ...r.transactions.map((id) => new Option(id, id)),
        );
        if (r.transactions.includes(previous)) receipts.value = previous;
      }
      result.textContent = JSON.stringify(r.details ?? r, null, 2);
      if (r.actionId) {
        confirm.textContent = "Confirm " + action;
        confirm.hidden = false;
        confirm.onclick = () => void run(action, r.actionId);
      }
    } catch (e) {
      if (n === requestNumber) result.textContent = String(e);
    } finally {
      if (n === requestNumber) controls.forEach((b) => (b.disabled = false));
    }
  }
  for (const [action, name] of [
    ["inspect", "Refresh receipts"],
    ["progress", "Check progress"],
    ["setup", "Set up data worktree"],
    ["recover", "Inspect transaction recovery"],
    ["commit", "Review commit"],
    ["push", "Review push"],
    ["pr", "Review pull request"],
    ["merge", "Review merge"],
    ["verify", "Verify integration"],
    ["cleanup", "Review original cleanup"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.onclick = () => void run(action);
    controls.push(button);
    buttons.append(button);
  }
  receipts.onchange = () => {
    confirm.hidden = true;
    result.textContent = "";
  };
  panel.className = "promotion-panel";
  panel.append(title, label, buttons, result, confirm);
  void run("inspect");
  return panel;
}
