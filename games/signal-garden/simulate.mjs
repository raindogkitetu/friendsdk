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
const maxPrize = definition.outcomes.reduce(
  (max, outcome) => BigInt(outcome.reward) > max ? BigInt(outcome.reward) : max, 0n);
const previewStake = maxPrize * 10n;
const previewBalance = 20n * BASE;

assert.equal(definition.outcomes.reduce((sum, outcome) => sum + outcome.chanceBps, 0), 10_000);
assert.equal(expected, 850_000_000_000_000_000n);
assert.equal(maxPrize, 2_500_000_000_000_000_000n);
assert.equal(price - expected, burn + seasonVault);
assert.equal(previewStake, 25n * BASE);

// Worst-case bankroll proof: assume every settled seed is the maximum 2.5 RF
// reward and immediately harvest between repeat plays. This is harsher than the
// expected-value path and proves the 15-signal peak Resonance tier is fundable
// from the SDK preview's initial 10x-max-prize stake.
let stake = previewStake;
let balance = previewBalance;
let freeStake = previewStake;
for (let signal = 1; signal <= 15; signal++) {
  assert(balance >= price, `Player balance cannot buy worst-case seed ${signal}`);
  assert(freeStake >= maxPrize, `Free stake cannot back worst-case seed ${signal}`);
  assert(freeStake + price >= maxPrize, `Purchase cannot reserve worst-case seed ${signal}`);
  stake += price;
  balance -= price;
  // Buy reserves maxPrize; settle at maxPrize; immediate harvest pays it out.
  stake -= maxPrize;
  balance += maxPrize;
  freeStake += price - maxPrize;
}
assert.equal(freeStake, 2_500_000_000_000_000_000n);

console.log(JSON.stringify({
  seedPriceRF: Number(price) / Number(BASE),
  expectedHarvestRF: Number(expected) / Number(BASE),
  expectedReturn: `${Number(expected * 10_000n / price) / 100}%`,
  maximumHarvestRF: Number(maxPrize) / Number(BASE),
  previewPrizeStakeRF: Number(previewStake) / Number(BASE),
  worstCaseFreeStakeAfter15RF: Number(freeStake) / Number(BASE),
  guaranteedPeakResonanceSignals: 15,
  proposedBurnRF: Number(burn) / Number(BASE),
  proposedSeasonVaultRF: Number(seasonVault) / Number(BASE),
  totalChanceBps: 10_000,
}, null, 2));
