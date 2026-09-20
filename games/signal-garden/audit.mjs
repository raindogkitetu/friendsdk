import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const here = new URL("./", import.meta.url);
const read = name => readFile(new URL(name, here), "utf8");
const [index, model, readme, browserCheck, simulation, gameText] = await Promise.all([
  read("index.tsx"),
  read("model.ts"),
  read("README.md"),
  read("check.mjs"),
  read("simulate.mjs"),
  read("game.json"),
]);
const game = JSON.parse(gameText);

const combined = [index, readme, browserCheck, simulation].join("\n");
const stale = [
  "SG MODEL BURN",
  "SG MODEL VAULT",
  "10% burn",
  "5% vault",
  "season-vault",
  "3, 6, 12 and 24",
  "INFINITE",
  "one-of-one signal garden",
  "expected harvest liability",
  "Buy a seed · 1 RF",
  "11 sim RF remains",
];
for (const phrase of stale) {
  assert.equal(combined.includes(phrase), false, "Stale Signal Garden wording returned: " + phrase);
}

const implementation = index + "\n" + model;
for (const forbidden of [
  "dangerouslySetInnerHTML",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "window.open(",
  "eval(",
  "new Function(",
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "wallet_send",
]) {
  assert.equal(implementation.includes(forbidden), false,
    "Signal Garden implementation contains forbidden/high-risk surface: " + forbidden);
}
assert.equal(index.includes("../../src/"), false,
  "Signal Garden must consume FriendSDK through public package exports, not internal src paths");
assert(index.includes("@rarefriends/friendsdk/runtime"));
assert(index.includes("@rarefriends/friendsdk/frame"));
assert(index.includes("@rarefriends/friendsdk/game"));
assert(index.includes("@rarefriends/friendsdk/sprites"));

for (const phrase of [
  "PROTOCOL REF BURN · 50%",
  "PROTOCOL REF REWARDS · 50%",
  "EVERGREEN",
  "SIM RF SPENT",
]) assert(index.includes(phrase), "Runtime is missing audited marker: " + phrase);

for (const phrase of [
  "50% burn / 50% rewards",
  "3, 6, 12 and 15",
  "6.2 sim RF",
  "2.5 sim RF free stake remains",
  "Do not add the 8.5 and 5/5 figures together.",
  "960, 760, 521 and 360",
  "keep the first twelve blooms",
  "test-only synchronization/readiness fixes",
]) assert(readme.includes(phrase), "README is missing audited statement: " + phrase);
assert.equal(readme.includes("fifteen `buy → play → settle → redeem`"), false,
  "README must not claim all 15 garden cycles redeem a bloom");
assert.equal((readme.match(/\| `simulate\.mjs` \|/g) ?? []).length, 1,
  "README Files table must list simulate.mjs exactly once");

for (const phrase of [
  "Official desktop viewport height must be 640px",
  "runChildFrameReloadRecovery",
  "PROTOCOL REF BURN · 50%7\\.5 sim RF",
  "BLOOMS DISCOVERED4\\/4",
  "await page.evaluate",
  "await run(960, true)",
  "await run(760)",
  "await run(521)",
  "await run(360)",
]) assert(browserCheck.includes(phrase), "Browser audit lost coverage: " + phrase);

for (const phrase of [
  "runGardenPath",
  'runGardenPath("maximum-reward path", 9_999)',
  'runGardenPath("minimum-reward path", 0)',
  "guaranteedPeakResonanceSignals: 15",
]) assert(simulation.includes(phrase), "Ledger stress proof lost coverage: " + phrase);

assert.equal(game.price, "1000000000000000000");
assert.equal(game.outcomes.reduce((sum, row) => sum + row.chanceBps, 0), 10_000);
const expected = game.outcomes.reduce(
  (sum, row) => sum + BigInt(row.reward) * BigInt(row.chanceBps), 0n) / 10_000n;
const maxReward = game.outcomes.reduce(
  (max, row) => BigInt(row.reward) > max ? BigInt(row.reward) : max, 0n);
assert.equal(expected, 850_000_000_000_000_000n);
assert.equal(maxReward, 2_500_000_000_000_000_000n);

console.log("PASS Signal Garden source/docs/browser/ledger consistency audit.");
