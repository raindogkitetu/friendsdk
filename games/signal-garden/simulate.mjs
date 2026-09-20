import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RF,
  createGamePreview,
  expectedReward,
  maximumPrize,
  parseChanceGame,
} from "../../dist/game.js";

const raw = JSON.parse(await readFile(new URL("./game.json", import.meta.url), "utf8"));
const definition = parseChanceGame(raw);
const price = definition.price;
const expected = expectedReward(definition);
const maxPrize = maximumPrize(definition);
const rewards = definition.outcomes.map(outcome => outcome.reward);
const minPrize = rewards.reduce((min, reward) => reward < min ? reward : min, rewards[0]);
const previewStake = maxPrize * 10n;
const previewBalance = 20n * RF;
const proposedBurn = price / 10n;
const proposedSeasonVault = price / 20n;

assert.equal(definition.outcomes.reduce((sum, outcome) => sum + outcome.chanceBps, 0), 10_000);
assert.equal(expected, 850_000_000_000_000_000n);
assert.equal(minPrize, 400_000_000_000_000_000n);
assert.equal(maxPrize, 2_500_000_000_000_000_000n);
assert.equal(price - expected, proposedBurn + proposedSeasonVault);
assert.equal(previewStake, 25n * RF);

async function runPath(name, roll) {
  const { client } = createGamePreview(definition, {
    stake: previewStake,
    rfBalance: previewBalance,
    friendId: 7730n,
    draw: () => roll,
  });
  for (let signal = 1; signal <= 15; signal++) {
    assert.equal(await client.canBuy(1n), true, name + ": seed " + signal + " must remain backed");
    await client.buy(1n);
    const [play] = await client.play(1n);
    assert(play, name + ": seed " + signal + " must create one play");
    const settled = await client.settle(play.id);
    assert.notEqual(settled.outcomeId, null, name + ": seed " + signal + " must settle");
    await client.redeem(settled.outcomeId, 1n);
  }
  const state = await client.read();
  assert.equal(state.consumables, 0n);
  assert.equal(state.plays.length, 15);
  assert(state.plays.every(play => play.outcomeId !== null));
  assert(state.inventory.every(quantity => quantity === 0n));
  assert.equal(state.reservedPlays, 0n);
  assert.equal(state.rewardLiability, 0n);
  assert.equal(state.freeStake, state.stake);
  return state;
}

// Roll 9999 always selects Starbloom (2.5 RF), the house-bankroll worst case.
const maxPath = await runPath("maximum-reward path", 9_999);
assert.equal(maxPath.rfBalance, 42_500_000_000_000_000_000n);
assert.equal(maxPath.freeStake, 2_500_000_000_000_000_000n);

// Roll 0 always selects Dewbud (0.4 RF), the player-balance worst case.
const minPath = await runPath("minimum-reward path", 0);
assert.equal(minPath.rfBalance, 11n * RF);
assert.equal(minPath.freeStake, 34n * RF);

console.log(JSON.stringify({
  seedPriceRF: Number(price) / Number(RF),
  expectedHarvestRF: Number(expected) / Number(RF),
  expectedReturn: String(Number(expected * 10_000n / price) / 100) + "%",
  minimumHarvestRF: Number(minPrize) / Number(RF),
  maximumHarvestRF: Number(maxPrize) / Number(RF),
  previewPrizeStakeRF: Number(previewStake) / Number(RF),
  maxRewardPathFreeStakeAfter15RF: Number(maxPath.freeStake) / Number(RF),
  maxRewardPathPlayerBalanceAfter15RF: Number(maxPath.rfBalance) / Number(RF),
  minRewardPathFreeStakeAfter15RF: Number(minPath.freeStake) / Number(RF),
  minRewardPathPlayerBalanceAfter15RF: Number(minPath.rfBalance) / Number(RF),
  guaranteedPeakResonanceSignals: 15,
  proposedBurnRF: Number(proposedBurn) / Number(RF),
  proposedSeasonVaultRF: Number(proposedSeasonVault) / Number(RF),
  totalChanceBps: 10_000,
}, null, 2));
