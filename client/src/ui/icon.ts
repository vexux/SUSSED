export type IconName = "unlock" | "send" | "sun" | "moon" | "copy" | "check" | "close" | "users" | "game" | "globe" | "lock" | "crown" | "key" | "refresh" | "chevron" | "switch" | "door" | "user" | "bell";

export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add(`icon-${name}`);
  const paths: Record<typeof name, string> = {
    unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0",
    send: "m21 3-7 18-4-8-8-4 19-6ZM10 13 21 3",
    sun: "M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.88-9.88 1.42-1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
    copy: "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
    check: "m5 12 4 4L19 6",
    close: "m18 6-12 12M6 6l12 12",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.87M14 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    game: "M6 11h4m-2-2v4m7-1h.01M18 10h.01M7 6h10a4 4 0 0 1 3.9 3.1l1 5A3 3 0 0 1 17 17l-2-2H9l-2 2a3 3 0 0 1-4.9-2.9l1-5A4 4 0 0 1 7 6Z",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    crown: "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Zm2 15h16",
    key: "M21 2 11 12m0 0a5 5 0 1 1-7.1 7.1A5 5 0 0 1 11 12Zm3-3 3 3m-6 0 3 3",
    refresh: "M21 2v6h-6M21 13a9 9 0 1 1-2.64-6.36L21 8",
    chevron: "m6 9 6 6 6-6",
    switch: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3",
    door: "M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M14 3l5 2v14l-5 2M14 3v18m-5-9h.01m12 0H11m4-4 4 4-4 4",
    user: "M20 21a8 8 0 0 0-16 0m8-10a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  };
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
