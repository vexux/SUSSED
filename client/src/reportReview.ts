import type { Socket } from "socket.io-client";

interface Report {
  id: string; roomId: string; reporter: string; target: string; reason: string;
  createdAt: number; decision?: string; reviewedAt?: number; reviewer?: string;
}

export function openReportReview(socket: Socket): void {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Player reports");
  dialog.className = "report-review";
  const title = document.createElement("h2");
  title.textContent = "Player reports";
  const close = document.createElement("button");
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  const content = document.createElement("section");
  const disconnect = () => dialog.close();
  socket.once("disconnect", disconnect);
  dialog.onclose = () => { socket.off("disconnect", disconnect); dialog.remove(); };
  dialog.append(title, close, content);
  document.body.append(dialog);
  dialog.showModal();
  function load() {
    content.textContent = "Loading reports…";
    socket.timeout(5000).emit("moderation:list", {}, (err: Error | null, reply?: { reports?: Report[]; error?: { message: string } }) => {
      if (!dialog.open) return;
      if (err || !reply?.reports) { content.textContent = reply?.error?.message ?? "Reports could not be loaded."; return; }
      content.textContent = reply.reports.length ? "" : "No reports.";
      for (const report of [...reply.reports].reverse()) {
        const row = document.createElement("article");
        row.textContent = `${new Date(report.createdAt).toLocaleString()} · ${report.reason} · Room ${report.roomId} · Reporter ${report.reporter} · Player ${report.target}`;
        if (report.decision) row.append(document.createTextNode(` · ${report.decision} by ${report.reviewer} · ${new Date(report.reviewedAt!).toLocaleString()}`));
        else for (const [decision, label] of [["dismiss", "Dismiss"], ["room-ban", "Ban from this room"]]) {
          const button = document.createElement("button");
          button.textContent = label;
          button.onclick = () => {
            if (decision === "room-ban" && !window.confirm("Ban this identity from the reported room?")) return;
            content.textContent = "Saving decision…";
            socket.timeout(5000).emit("moderation:review", { id: report.id, decision }, (error: Error | null, result?: { reviewed?: boolean; error?: { message: string } }) => {
              if (!dialog.open) return;
              if (error || !result?.reviewed) content.textContent = result?.error?.message ?? "The decision could not be confirmed.";
              else load();
            });
          };
          row.append(button);
        }
        content.append(row);
      }
    });
  }
  load();
}
