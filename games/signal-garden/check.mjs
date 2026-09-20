import assert from "node:assert/strict";
import { resolve } from "node:path";
import { testGame } from "@rarefriends/friendsdk/testing";

const gameDirectory = resolve("games/signal-garden");
const bloomNames = new Set(["Dewbud", "Sunpetal", "Prismvine", "Starbloom"]);

async function run(width) {
  await testGame(gameDirectory, {
    width,
    height: 800,
    screenshot: resolve(`games/signal-garden/media/signal-garden-${width}.png`),
    check: async ({ page, game }) => {
      const confirm = async () => {
        const button = page.getByRole("button", { name: "Confirm preview", exact: true });
        await button.waitFor();
        await button.click();
      };
      const buySeed = async () => {
        await game.getByRole("button", { name: "Buy a seed · 1 RF", exact: true }).click();
        await game.getByRole("heading", { name: "Signal Seed exchange", exact: true }).waitFor();
        await game.locator(".rf-frame-menu").getByRole("button", { name: "Buy one Signal Seed · 1 RF", exact: true }).click();
        await confirm();
        await game.getByRole("button", { name: "Choose a plot", exact: true }).waitFor();
      };

      await buySeed();

      // Interrupt settlement after the SDK has committed the play. The game must
      // refresh state and resume that exact play without buying or using again.
      await game.locator("body").evaluate(() => {
        const original = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...args) {
          if (window.__signalFailNextSettle && message?.method === "settle") {
            window.__signalFailNextSettle = false;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
              data: { type: "friendsdk:response", id: message.id, error: "Fixture interrupted signal" },
            })), 0);
            return;
          }
          return original.call(this, message, ...args);
        };
        window.__signalFailNextSettle = true;
      });
      await game.getByTestId("plot-1").click();
      await confirm();
      await game.getByRole("button", { name: "Resume signal", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Confirm preview", exact: true }).count(), 0,
        "A pending signal must not ask for another play confirmation");
      await game.getByRole("button", { name: "Resume signal", exact: true }).click();
      await game.getByRole("heading", { name: "A new signal bloomed", exact: true }).waitFor();
      const firstBloom = (await game.locator(".signal-reveal h3").textContent())?.trim() ?? "";
      assert(bloomNames.has(firstBloom), `Unknown bloom: ${firstBloom}`);
      await game.getByRole("button", { name: "Keep in garden", exact: true }).click();
      await game.getByTestId("plot-1").click();
      await game.getByRole("heading", { name: "Plot memory", exact: true }).waitFor();
      assert.match(await game.locator(".signal-inspect").textContent(), /harmony/);
      await game.getByRole("button", { name: "Harvest bloom", exact: true }).click();
      await confirm();
      await game.getByRole("button", { name: /^Plot 1, empty/ }).waitFor();
      assert.match(await game.getByTestId("plot-1").getAttribute("aria-label"), /empty/);

      await game.getByRole("button", { name: "Guide", exact: true }).click();
      await game.getByText(/Its on-chain family makes/).waitFor();
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();
      await game.getByRole("button", { name: "Settings", exact: true }).click();
      const reduced = game.getByLabel("Reduce motion", { exact: true });
      assert.equal(await reduced.isChecked(), true);
      await reduced.uncheck();
      assert.equal(await reduced.isChecked(), false);
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      // Leave one kept bloom in the captured frame.
      await buySeed();
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
      assert.match(await game.locator(".signal-activity").textContent(), /SIMULATED SESSION SPEND3 RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /SG MODEL BURN · 10%0\.3 RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /SG MODEL VAULT · 5%0\.15 RF/);
      assert.match(await game.locator(".signal-activity").textContent(), /SESSION RESONANCETUNED/);
      assert.match(await game.locator(".signal-activity").textContent(), /BLOOMS DISCOVERED[1-3]\/4/);
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      // Discovery is historical for the session: harvesting the first bloom must
      // not erase it from the discovered set.
      await game.getByRole("button", { name: /Collection/, exact: false }).click();
      const discoveredRow = game.locator(".signal-collection>div").filter({ hasText: firstBloom });
      await discoveredRow.waitFor();
      assert.match(await discoveredRow.textContent(), /discovered/);
      await game.locator(".rf-frame-menu").getByRole("button", { name: /^Close / }).click();

      const problems = await game.locator("body").evaluate(() => {
        const body = document.body.getBoundingClientRect(), issues = [];
        for (const selector of [".signal-header", ".signal-grid", ".signal-friend-card", ".signal-dock"]) {
          const node = document.querySelector(selector);
          if (!node) { issues.push(`Missing ${selector}`); continue; }
          const box = node.getBoundingClientRect();
          if (box.left < -1 || box.top < -1 || box.right > body.right + 1 || box.bottom > body.bottom + 1) {
            issues.push(`Outside viewport: ${selector}`);
          }
        }
        return issues;
      });
      assert.deepEqual(problems, []);
      assert.equal(await game.locator("nav,.rf-game-frame").count(), 0, "Game must not contain app scaffolding");
      assert.match(await game.locator(".signal-metrics").textContent(), /SEEDS0RF SPENT3/);
      const spentMetric = game.locator(".signal-metrics>span").filter({ hasText: "RF SPENT" });
      assert.equal(await spentMetric.isVisible(), true,
        "Cumulative RF spend must remain visible in the HUD, including the 360px layout");
    },
  });
  console.log(`PASS Signal Garden full loop at ${width}px: buy, pending recovery, reveal, keep, inspect, harvest, activity receipt, discovery, resonance, settings and bounds.`);
}

await run(960);
await run(360);
