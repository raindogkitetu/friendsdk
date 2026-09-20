import assert from "node:assert/strict";
import { resolve } from "node:path";
import { testGame } from "@rarefriends/friendsdk/testing";

const gameDirectory = resolve("games/signal-garden");
const bloomNames = new Set(["Dewbud", "Sunpetal", "Prismvine", "Starbloom"]);

async function run(width, extended = false) {
  await testGame(gameDirectory, {
    width,
    height: 800,
    screenshot: resolve(`games/signal-garden/media/signal-garden-${width}.png`),
    check: async ({ page, game }) => {
      const frameBox = await page.locator(".rf-game-frame").boundingBox();
      assert(frameBox, "SDK game frame must be mounted");
      if (width === 960) {
        assert.equal(Math.round(frameBox.width), 960, "Official desktop viewport width must be 960px");
        assert.equal(Math.round(frameBox.height), 640, "Official desktop viewport height must be 640px");
      }
      assert.match(await game.locator(".signal-metrics").textContent(), /SIM RF20SEEDS0SIM RF SPENT0/,
        "Preview must start at the SDK runtime's 20 sim RF balance with zero spend");

      // Prove the documented input modes instead of inferring them from native
      // buttons. Desktop activates Guide from keyboard focus; phone uses a real
      // touch event through Playwright's touch-enabled context.
      if (width === 960) {
        const guide = game.getByRole("button", { name: "Guide", exact: true });
        await guide.focus();
        await page.keyboard.press("Enter");
        await game.getByText(/Its on-chain family makes/).waitFor();
        await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();
      }
      if (width === 360) {
        await game.getByRole("button", { name: "Guide", exact: true }).tap();
        await game.getByText(/Its on-chain family makes/).waitFor();
        await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).tap();
      }

      if (extended) {
        await page.evaluate(() => {
          const original = crypto.getRandomValues.bind(crypto);
          const rolls = [1500, 6000, 8500, 9700, 1500, 6000, 8500, 9700,
            1500, 6000, 8500, 9700, 1500, 6000, 8500];
          crypto.getRandomValues = array => {
            if (array instanceof Uint32Array && array.length === 1 && rolls.length) {
              array[0] = rolls.shift();
              return array;
            }
            return original(array);
          };
        });
      }

      const confirm = async () => {
        const button = page.getByRole("button", { name: "Confirm preview", exact: true });
        await button.waitFor();
        await button.click();
      };
      const buySeed = async () => {
        await game.getByRole("button", { name: "Buy a seed · 1 sim RF", exact: true }).click();
        await game.getByRole("heading", { name: "Signal Seed exchange", exact: true }).waitFor();
        await game.locator(".rf-frame-menu").getByRole("button", { name: "Buy one Signal Seed · 1 sim RF", exact: true }).click();
        await confirm();
        await game.getByRole("button", { name: "Choose a plot", exact: true }).waitFor();
      };

      await buySeed();

      // Interrupt settlement after the SDK has committed the play. The game must
      // refresh state and resume that exact play without buying or using again.
      await game.locator("body").evaluate(() => {
        const original = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...args) {
          if ((window.__signalFailReadCount ?? 0) > 0 && message?.method === "read") {
            window.__signalFailReadCount--;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
              data: { type: "friendsdk:response", id: message.id, error: "Fixture interrupted read" },
            })), 0);
            return;
          }
          if (window.__signalFailNextSettle && message?.method === "settle") {
            window.__signalFailNextSettle = false;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
              data: { type: "friendsdk:response", id: message.id, error: "Fixture interrupted signal" },
            })), 0);
            return;
          }
          return original.call(this, message, ...args);
        };
        window.__signalFailReadCount = 0;
        window.__signalFailNextSettle = true;
      });
      await game.locator("body").evaluate(() => {
        document.querySelector('[data-testid="plot-5"]')?.click();
        document.querySelector('[data-testid="plot-6"]')?.click();
      });
      await confirm();
      await game.getByRole("button", { name: "Resume signal", exact: true }).waitFor();
      const dockStatus = game.locator(".signal-action p");
      assert.equal(await dockStatus.isVisible(), true, "Action errors must remain visible at phone width");
      assert.match(await dockStatus.textContent(), /Fixture interrupted signal/);
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "A pending signal must not ask for another play confirmation");
      await game.getByTestId("plot-1").click();
      assert.match(await dockStatus.textContent(), /pending signal belongs to plot 5/i);
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "A known pending signal must not be movable to another plot");
      assert.match(await game.getByTestId("plot-1").getAttribute("aria-label"), /empty/);
      await game.getByRole("button", { name: "Resume signal", exact: true }).click();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      const firstBloom = (await game.locator(".signal-reveal h3").textContent())?.trim() ?? "";
      assert(bloomNames.has(firstBloom), `Unknown bloom: ${firstBloom}`);
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();
      assert.match(await game.getByTestId("plot-5").getAttribute("aria-label"), /inspect/,
        "Resumed signal must settle into the originally selected plot");
      assert.match(await game.getByTestId("plot-1").getAttribute("aria-label"), /empty/,
        "Resume must not fall back to the first empty plot");
      await game.getByTestId("plot-5").click();
      await game.getByRole("heading", { name: "Plot memory", exact: true }).waitFor();
      assert.match(await game.locator(".signal-inspect").textContent(), /harmony/);
      await game.getByRole("button", { name: "Harvest bloom", exact: true }).click();
      await game.locator("body").evaluate(() => { window.__signalFailReadCount = 1; });
      await confirm();
      await game.getByRole("button", { name: /^Plot 5, empty/ }).waitFor();
      assert.match(await game.getByTestId("plot-5").getAttribute("aria-label"), /empty/);

      await game.getByRole("button", { name: "Guide", exact: true }).click();
      await game.getByText(/Its on-chain family makes/).waitFor();
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();
      await game.getByRole("button", { name: "Settings", exact: true }).click();
      const reduced = game.getByLabel("Reduce motion", { exact: true });
      assert.equal(await reduced.isChecked(), true);
      await reduced.uncheck();
      assert.equal(await reduced.isChecked(), false);
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      // A purchase can complete even if the next two state reads fail. The game
      // must block further economy actions until a verified refresh succeeds,
      // without buying a second seed.
      await game.getByRole("button", { name: "Buy a seed · 1 sim RF", exact: true }).click();
      await game.getByRole("heading", { name: "Signal Seed exchange", exact: true }).waitFor();
      await game.locator(".rf-frame-menu").getByRole("button", { name: "Buy one Signal Seed · 1 sim RF", exact: true }).click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).waitFor();
      await game.locator("body").evaluate(() => { window.__signalFailReadCount = 2; });
      await confirm();
      await game.getByRole("button", { name: "Refresh verified state", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "State resync must not trigger another purchase confirmation");
      await game.getByRole("button", { name: "Refresh verified state", exact: true }).click();
      await game.getByRole("button", { name: "Choose a plot", exact: true }).waitFor();

      // Leave one kept bloom in the captured frame.
      await game.getByTestId("plot-2").click();
      await confirm();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();

      // A third settled signal reaches the first non-financial resonance tier.
      await buySeed();
      await game.getByTestId("plot-3").click();
      await confirm();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();

      // The receipt keeps gross RF activity visible even after a prior bloom was harvested.
      await game.getByRole("button", { name: "Guide", exact: true }).click();
      await game.getByRole("button", { name: "View activity receipt", exact: true }).click();
      await game.getByRole("heading", { name: "Token activity receipt", exact: true }).waitFor();
      assert.match(await game.locator(".signal-activity").textContent(), /SIMULATED SESSION SPEND3 sim RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /PROTOCOL REF BURN · 50%1\.5 sim RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /PROTOCOL REF REWARDS · 50%1\.5 sim RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /SESSION RESONANCETUNED/);
      assert.match(await game.locator(".signal-activity").textContent(), /BLOOMS DISCOVERED[1-3]\/4/);
      if (width === 360) {
        await page.locator(".rf-game-frame").screenshot({
          path: resolve("games/signal-garden/media/signal-garden-activity-360.png"),
        });
      }
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      // Discovery is historical for the session: harvesting the first bloom must
      // not erase it from the discovered set. Enter through Guide so the path is
      // also available in the 360px layout where the dock collection button hides.
      await game.getByRole("button", { name: "Guide", exact: true }).click();
      await game.getByRole("button", { name: "View collection", exact: true }).click();
      const discoveredRow = game.locator(".signal-collection>div").filter({ hasText: firstBloom });
      await discoveredRow.waitFor();
      assert.match(await discoveredRow.textContent(), /discovered/);
      if (width === 360) {
        await page.locator(".rf-game-frame").screenshot({
          path: resolve("games/signal-garden/media/signal-garden-collection-360.png"),
        });
      }
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      if (extended) {
        const plantOne = async () => {
          await buySeed();
          const empty = game.locator(".signal-plot.signal-empty").first();
          await empty.click();
          await confirm();
          await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
          await game.getByRole("button", { name: "Keep in garden", exact: true }).click();
        };
        const harvestFirst = async () => {
          await game.locator(".signal-plot.signal-filled").first().click();
          await game.getByRole("heading", { name: "Plot memory", exact: true }).waitFor();
          await game.getByRole("button", { name: "Harvest bloom", exact: true }).click();
          await confirm();
        };

        // We have three settled signals and two kept blooms at this point. Fill
        // the remaining ten plots: 13 settled signals, 12 kept blooms, full board.
        for (let index = 0; index < 10; index++) await plantOne();
        assert.equal(await game.locator(".signal-plot.signal-empty").count(), 0);
        assert.match(await game.locator(".signal-score-card").textContent(), /12\/12 blooms · complete/);
        assert.match(await game.locator(".signal-resonance").textContent(), /HARMONIC/);
        const fullAction = game.locator(".signal-primary");
        assert.equal(await fullAction.isDisabled(), true, "A full garden must block another seed purchase");
        assert.equal((await fullAction.textContent())?.trim(), "Garden full");
        assert.match(await game.locator(".signal-action p").textContent(), /Harvest a bloom to reopen a plot/);

        // Reopen one slot, grow signal 14, reopen again, then grow signal 15.
        // This proves the advertised repeat loop and peak Resonance in the real UI.
        await harvestFirst();
        await game.locator(".signal-plot.signal-empty").first().waitFor();
        assert.equal(await game.getByRole("button", { name: "Buy a seed · 1 sim RF", exact: true }).isEnabled(), true);
        await plantOne();
        await harvestFirst();
        await plantOne();

        assert.equal(await game.locator(".signal-plot.signal-empty").count(), 0);
        assert.match(await game.locator(".signal-resonance").textContent(), /EVERGREEN/);
        await game.getByRole("button", { name: "Guide", exact: true }).click();
        await game.getByRole("button", { name: "View activity receipt", exact: true }).click();
        assert.match(await game.locator(".signal-activity").textContent(), /SIMULATED SESSION SPEND15 sim RF/);
        assert.match(await game.locator(".signal-activity").textContent(), /SESSION RESONANCEEVERGREEN/);
        assert.match(await game.locator(".signal-activity").textContent(), /BLOOMS DISCOVERED4\/4/);
        assert.match(await game.locator(".signal-activity").textContent(), /PROTOCOL REF BURN · 50%7\.5 sim RF/);
        assert.match(await game.locator(".signal-activity").textContent(), /PROTOCOL REF REWARDS · 50%7\.5 sim RF/);
        await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();
        assert.match(await game.getByRole("button", { name: /Collection/, exact: false }).textContent(), /4\/4/);
      }

      const problems = await game.locator("body").evaluate(() => {
        const body = document.body.getBoundingClientRect(), issues = [];
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) {
          issues.push("Game document overflow");
        }
        for (const selector of [".signal-header", ".signal-grid", ".signal-friend-card", ".signal-dock", ".signal-action p"]) {
          const node = document.querySelector(selector);
          if (!node) { issues.push(`Missing ${selector}`); continue; }
          const box = node.getBoundingClientRect();
          if (box.left < -1 || box.top < -1 || box.right > body.right + 1 || box.bottom > body.bottom + 1) {
            issues.push(`Outside viewport: ${selector}`);
          }
        }
        const stage = document.querySelector(".signal-stage")?.getBoundingClientRect();
        if (!stage) issues.push("Missing .signal-stage");
        else {
          document.querySelectorAll(".signal-plot").forEach((node, index) => {
            const box = node.getBoundingClientRect();
            if (box.left < stage.left - 1 || box.right > stage.right + 1 ||
                box.top < stage.top - 1 || box.bottom > stage.bottom + 1) {
              issues.push(`Plot ${index + 1} clipped by stage`);
            }
          });
        }
        for (const selector of [".signal-header>button", ".signal-metrics>span"]) {
          for (const node of document.querySelectorAll(selector)) {
            if (getComputedStyle(node).display === "none") continue;
            const box = node.getBoundingClientRect();
            if (box.left < -1 || box.right > body.right + 1 || box.top < -1 || box.bottom > body.bottom + 1) {
              issues.push(`Clipped control: ${selector}`);
            }
          }
        }
        const status = document.querySelector(".signal-action p");
        if (status && getComputedStyle(status).pointerEvents !== "none") issues.push("Status blocks pointer input");
        return issues;
      });
      assert.deepEqual(problems, []);
      assert.equal(await game.locator("nav,.rf-game-frame").count(), 0, "Game must not contain app scaffolding");
      const unnamedButtons = await game.locator("button").evaluateAll(nodes =>
        nodes.filter(node => !(node.getAttribute("aria-label") || node.textContent?.trim())).length);
      assert.equal(unnamedButtons, 0, "Every game button must expose an accessible name");
      assert.equal(await game.locator('canvas[role="img"][aria-label]').count(), 1,
        "The canonical Friend canvas must expose an image role and accessible name");
      const expectedSpend = extended ? "15" : "3";
      assert.match(await game.locator(".signal-metrics").textContent(),
        new RegExp(`SEEDS0SIM RF SPENT${expectedSpend}`));
      const spentMetric = game.locator(".signal-metrics>span").filter({ hasText: "RF SPENT" });
      assert.equal(await spentMetric.isVisible(), true,
        "Cumulative RF spend must remain visible in the HUD, including the 360px layout");
    },
  });
  console.log(`PASS Signal Garden at ${width}px: recovery, resync, responsive UI${extended ? ", full 15-signal repeat loop" : ""}.`);
}


async function runChildFrameReloadRecovery() {
  await testGame(gameDirectory, {
    width: 960,
    height: 800,
    check: async ({ page, game }) => {
      const confirm = async () => {
        const button = page.getByRole("button", { name: "Confirm preview", exact: true });
        await button.waitFor();
        await button.click();
      };
      const reloadChild = async () => {
        const iframe = page.locator("iframe");
        await iframe.evaluate(node => new Promise(resolve => {
          node.addEventListener("load", () => resolve(true), { once: true });
          node.src = node.src;
        }));
        await game.locator("#root > *").first().waitFor();
        await game.getByText("Waiting for your Friend…", { exact: true }).waitFor({ state: "hidden" });
        await page.locator(".rf-runtime-status").waitFor({ state: "hidden" });
      };
      const buySeed = async () => {
        await game.getByRole("button", { name: "Buy a seed · 1 sim RF", exact: true }).click();
        await game.getByRole("heading", { name: "Signal Seed exchange", exact: true }).waitFor();
        await game.locator(".rf-frame-menu").getByRole("button", { name: "Buy one Signal Seed · 1 sim RF", exact: true }).click();
        await confirm();
        await game.getByRole("button", { name: "Choose a plot", exact: true }).waitFor();
      };

      // Keep one bloom, then reload only the sandbox child. The host ledger must
      // survive while the session-local plot memory is rebuilt.
      await buySeed();
      await game.getByTestId("plot-5").click();
      await confirm();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();
      assert.equal(await game.locator(".signal-plot.signal-filled").count(), 1);
      await reloadChild();
      assert.equal(await game.locator(".signal-plot.signal-filled").count(), 1,
        "Child reload must rebuild kept inventory from the host ledger");
      assert.match(await game.locator(".signal-metrics").textContent(), /SIM RF19SEEDS0SIM RF SPENT1/);
      assert.match(await game.getByTestId("plot-1").getAttribute("aria-label"), /inspect/,
        "Rebuilt inventory uses the documented deterministic first-open plot order");

      // Commit a play but interrupt its settlement, then reload the child again.
      // pendingPlot is intentionally session-local, so the reloaded game should
      // ask for a resume plot while reusing the already-paid pending play.
      await buySeed();
      await game.locator("body").evaluate(() => {
        const original = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...args) {
          if (window.__reloadFailNextSettle && message?.method === "settle") {
            window.__reloadFailNextSettle = false;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
              data: { type: "friendsdk:response", id: message.id, error: "Fixture interrupted signal before child reload" },
            })), 0);
            return;
          }
          return original.call(this, message, ...args);
        };
        window.__reloadFailNextSettle = true;
      });
      await game.getByTestId("plot-7").click();
      await confirm();
      await game.getByRole("button", { name: "Resume signal", exact: true }).waitFor();
      await reloadChild();

      await game.getByRole("button", { name: "Choose resume plot", exact: true }).waitFor();
      assert.match(await game.locator(".signal-action p").textContent(), /Choose an empty plot to resume it/);
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "Reloaded pending play must not request another purchase/play confirmation");

      await game.getByTestId("plot-8").click();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "Settling an already-paid preview play after reload needs no second confirmation");
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();

      assert.equal(await game.locator(".signal-plot.signal-filled").count(), 2);
      assert.match(await game.locator(".signal-metrics").textContent(), /SIM RF18SEEDS0SIM RF SPENT2/);
      assert.match(await game.getByTestId("plot-8").getAttribute("aria-label"), /inspect/);
    },
  });
  console.log("PASS Signal Garden child-frame reload: kept inventory rebuild and pending-play recovery.");
}

await run(960, true);
await run(760);
await run(521);
await run(360);
await runChildFrameReloadRecovery();
