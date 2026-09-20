import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const definition = JSON.parse(await readFile(new URL("./game.json", import.meta.url), "utf8"));
const BASE = 10n ** 18n;
const price = BigInt(definition.price);
const weighted = definition.outcomes.reduce((sum, outcome) =>
  sum + BigInt(outcome.chanceBps) * BigInt(outcome.reward), 0n);
const expected = weighted / 10_000n;
const burn = price / 10n;
const seasonVault = price / 20n;

assert.equal(definition.outcomes.reduce((sum, outcome) => sum + outcome.chanceBps, 0), 10_000);
assert.equal(expected, 850_000_000_000_000_000n);
assert.equal(price - expected, burn + seasonVault);

console.log(JSON.stringify({
  seedPriceRF: Number(price) / Number(BASE),
  expectedHarvestRF: Number(expected) / Number(BASE),
  expectedReturn: `${Number(expected * 10_000n / price) / 100}%`,
  proposedBurnRF: Number(burn) / Number(BASE),
  proposedSeasonVaultRF: Number(seasonVault) / Number(BASE),
  totalChanceBps: 10_000,
}, null, 2));
