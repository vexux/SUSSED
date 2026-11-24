import { expect, test, type Page } from "@playwright/test";

async function viewResults(page: Page, heading: string) {
  // A fresh document can show personal round feedback over the results again.
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  const dismiss = page.locator(".round-feedback-continue");
  if (await dismiss.isVisible()) await dismiss.click();
  await expect(dismiss).toBeHidden();
}

async function playRound(host: Page, guest: Page, round: number, guestId: string) {
  const pages = [host, guest];
  const bluffs = [`copper lantern ${round}`, `velvet comet ${round}`];
  for (const page of [guest, host]) {
    await expect(page.getByText(`Round ${round} of 5`, { exact: true })).toBeVisible();
    await page.getByLabel("Your answer").fill(bluffs[page === host ? 0 : 1]);
    await page.locator(".submission-form").getByRole("button", { name: "Submit" }).click();
    if (page === guest && round === 2) {
      const submitted = host.locator(".submission-player-list li").filter({
        has: host.getByRole("img", { name: "Submitted", exact: true }),
      });
      await expect(submitted).toHaveAttribute("data-player-id", guestId);
      await expect(submitted).toContainText("Wren");
    }
  }
  for (const [index, page] of pages.entries()) {
    await page.getByRole("radio", { name: bluffs[1 - index], exact: true }).check();
    await page.locator(".vote-form").getByRole("button", { name: "Submit" }).click();
  }
  for (const page of pages) {
    await viewResults(page, round === 5 ? "Final leaderboard" : "Current leaderboard");
  }
}

async function standings(page: Page) {
  const rows = page.locator(".final-leaderboard .standing-card");
  await expect(rows).toHaveCount(2);
  return rows.evaluateAll(items => items.map(item => ({
    id: item.getAttribute("data-player-id"),
    rank: item.querySelector(".standing-rank")?.textContent,
    name: item.querySelector(".standing-name")?.textContent,
    score: item.querySelector(".standing-score")?.textContent,
  })));
}

test("two guests finish a match and restore live and archived results", async ({ page: host, browser, baseURL }) => {
  const guestContext = await browser.newContext({ baseURL });
  try {
    const guest = await guestContext.newPage();
    await host.goto("/");
    await host.getByLabel("Player name").fill("Robin");
    await host.getByRole("button", { name: "Choose a game" }).click();
    const card = host.locator(".game-card").filter({ has: host.getByRole("heading", { name: "Fact or Cap", exact: true }) });
    const select = card.getByRole("button", { name: "Select game" });
    await expect(card).toBeVisible();
    if (await select.isVisible()) await select.click();
    await host.getByRole("button", { name: "Create room" }).click();
    const code = await host.locator(".room-code-chip-value").innerText();
    expect(code).toMatch(/^[A-Z]{4}$/);

    await guest.goto("/");
    await guest.getByLabel("Player name").fill("Wren");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join room" }).click();
    for (const page of [host, guest]) {
      await expect(page.locator(".room-code-chip-value")).toHaveText(code);
      await expect(page.locator(".player-card .player-name")).toHaveText(["Robin", "Wren"]);
    }
    const localGuest = guest.locator(".player-card.local-player");
    await expect(localGuest).toContainText("Wren");
    const guestId = await localGuest.getAttribute("data-player-id");
    if (!guestId) throw new Error("Guest lobby card is missing its player ID");
    await guest.getByRole("button", { name: "Ready", exact: true }).click();
    await host.getByRole("button", { name: "Start game" }).click();
    await playRound(host, guest, 1, guestId);

    await guest.reload();
    await expect(guest.locator(".game-spectator-notice")).toBeVisible();
    await viewResults(guest, "Current leaderboard");
    await expect(guest.locator(".standing-card").filter({ hasText: "Wren" })).toHaveAttribute("data-player-id", guestId);
    await host.getByRole("button", { name: "Continue", exact: true }).click();
    for (let round = 2; round <= 5; round++) {
      await playRound(host, guest, round, guestId);
      if (round < 5) {
        for (const page of [host, guest]) {
          await page.getByRole("button", { name: "Continue", exact: true }).click();
        }
      }
    }

    const final = await standings(guest);
    expect(final.map(row => row.name).sort()).toEqual(["Robin", "Wren"]);
    for (const row of final) expect(row.score).toMatch(/^-?\d+ points?$/);
    expect(await standings(host)).toEqual(final);
    const assertHostLobby = async () => {
      await expect(host.locator(".room-code-chip-value")).toHaveText(code);
      await expect(host.getByRole("button", { name: "Start game" })).toBeVisible();
    };
    await host.getByRole("button", { name: "Return to lobby", exact: true }).click();
    await assertHostLobby();
    await guest.reload();
    await viewResults(guest, "Final leaderboard");
    await expect(guest.getByRole("button", { name: "Return to Lobby", exact: true })).toBeEnabled();
    expect(await standings(guest)).toEqual(final);
    await assertHostLobby();
  } finally {
    await guestContext.close();
  }
});
