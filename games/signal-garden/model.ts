export type BloomMeta = Readonly<{
  name: string;
  short: string;
  tone: string;
  score: number;
  lore: string;
}>;

export type GardenBloom = Readonly<{
  outcomeId: number;
  playId: string;
}>;

export const BLOOMS: readonly BloomMeta[] = Object.freeze([
  Object.freeze({
    name: "Dewbud",
    short: "dew",
    tone: "mint",
    score: 1,
    lore: "A quiet signal that steadies the garden.",
  }),
  Object.freeze({
    name: "Sunpetal",
    short: "sun",
    tone: "gold",
    score: 2,
    lore: "A warm pulse that follows its Friend.",
  }),
  Object.freeze({
    name: "Prismvine",
    short: "prism",
    tone: "violet",
    score: 4,
    lore: "A split-spectrum vine tuned to rare signals.",
  }),
  Object.freeze({
    name: "Starbloom",
    short: "star",
    tone: "coral",
    score: 8,
    lore: "A scarce bloom bright enough to anchor a season.",
  }),
]);

export const PLOT_COUNT = 12;

export function signalPlots(seed: number) {
  const start = Math.abs(seed) % 4;
  return Object.freeze([start, start + 4, start + 8]);
}

export function affinityIndex(familyId: number) {
  return Math.abs(familyId) % BLOOMS.length;
}

export function bloomScore(outcomeId: number, plotIndex: number, familyId: number, seed: number) {
  const bloom = BLOOMS[outcomeId - 1];
  if (!bloom) return 0;
  const affinity = outcomeId - 1 === affinityIndex(familyId) ? 3 : 0;
  const signal = signalPlots(seed).includes(plotIndex) ? 2 : 0;
  const harmony = affinity && signal ? 3 : 0;
  return bloom.score + affinity + signal + harmony;
}

export function totalGardenScore(
  plots: readonly (GardenBloom | null)[], familyId: number, seed: number,
) {
  return plots.reduce((total, bloom, index) =>
    total + (bloom ? bloomScore(bloom.outcomeId, index, familyId, seed) : 0), 0);
}

/** Rebuild a visible garden from the host-owned inventory after a child-frame reload. */
export function gardenFromInventory(inventory: readonly bigint[]) {
  const plots: (GardenBloom | null)[] = Array.from({ length: PLOT_COUNT }, () => null);
  let plot = 0;
  inventory.forEach((quantity, outcomeIndex) => {
    for (let count = 0n; count < quantity && plot < PLOT_COUNT; count++) {
      plots[plot] = { outcomeId: outcomeIndex + 1, playId: `restored-${outcomeIndex + 1}-${count}` };
      plot++;
    }
  });
  return plots;
}
