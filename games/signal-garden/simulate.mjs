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
const protocolBurnReference = price / 2n;
const protocolRewardsReference = price - protocolBurnReference;

assert.equal(definition.outcomes.reduce((sum, outcome) => sum + outcome.chanceBps, 0), 10_000);
assert.equal(expected, 850_000_000_000_000_000n);
assert.equal(minPrize, 400_000_000_000_000_000n);
assert.equal(maxPrize, 2_500_000_000_000_000_000n);
assert.equal(protocolBurnReference + protocolRewardsReference, price);
assert.equal(previewStake, 25n * RF);

async function runGardenPath(name, roll) {
  const { client } = createGamePreview(definition, {
    stake: previewStake,
    rfBalance: previewBalance,
    friendId: 7730n,
    draw: () => roll,
  });
  const kept = [];
  for (let signal = 1; signal <= 15; signal++) {
    // The real UI keeps blooms until the 12-slot garden is full. For signals
    // 13-15 it harvests exactly one kept bloom to reopen one slot, then buys.
    if (signal > 12) {
      const outcomeId = kept.shift();
      assert(outcomeId, name + ": a kept bloom must exist to reopen a slot");
      await client.redeem(outcomeId, 1n);
    }
    assert.equal(await client.canBuy(1n), true, name + ": seed " + signal + " must remain backed");
    await client.buy(1n);
    const [play] = await client.play(1n);
    assert(play, name + ": seed " + signal + " must create one play");
    const settled = await client.settle(play.id);
    assert.notEqual(settled.outcomeId, null, name + ": seed " + signal + " must settle");
    kept.push(settled.outcomeId);
  }
  const state = await client.read();
  assert.equal(state.consumables, 0n);
  assert.equal(state.plays.length, 15);
  assert(state.plays.every(play => play.outcomeId !== null));
  assert.equal(state.inventory.reduce((sum, quantity) => sum + quantity, 0n), 12n);
  assert.equal(state.reservedPlays, 0n);
  assert.equal(state.freeStake, state.stake - state.rewardLiability);
  return state;
}

// Roll 9999 always selects Starbloom (2.5 RF), the house-bankroll worst case.
const maxPath = await runGardenPath("maximum-reward path", 9_999);
assert.equal(maxPath.rfBalance, 12_500_000_000_000_000_000n);
assert.equal(maxPath.rewardLiability, 30n * RF);
assert.equal(maxPath.freeStake, 2_500_000_000_000_000_000n);

// Roll 0 always selects Dewbud (0.4 RF), the player-balance worst case.
const minPath = await runGardenPath("minimum-reward path", 0);
assert.equal(minPath.rfBalance, 6_200_000_000_000_000_000n);
assert.equal(minPath.rewardLiability, 4_800_000_000_000_000_000n);
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
  maxRewardPathKeptLiabilityAfter15RF: Number(maxPath.rewardLiability) / Number(RF),
  minRewardPathFreeStakeAfter15RF: Number(minPath.freeStake) / Number(RF),
  minRewardPathPlayerBalanceAfter15RF: Number(minPath.rfBalance) / Number(RF),
  minRewardPathKeptLiabilityAfter15RF: Number(minPath.rewardLiability) / Number(RF),
  guaranteedPeakResonanceSignals: 15,
  protocolBurnReferenceRF: Number(protocolBurnReference) / Number(RF),
  protocolRewardsReferenceRF: Number(protocolRewardsReference) / Number(RF),
  totalChanceBps: 10_000,
}, null, 2));
