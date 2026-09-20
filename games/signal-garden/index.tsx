"use client";

import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { expectedReward, maximumPrize, type GamePlay, type GameSnapshot } from "@rarefriends/friendsdk/game";
import {
  createFriendReader,
  spriteFrame,
  type GenerationSprites,
} from "@rarefriends/friendsdk/sprites";
import {
  affinityIndex,
  BLOOMS,
  bloomScore,
  gardenFromInventory,
  reconcileGardenWithInventory,
  PLOT_COUNT,
  signalPlots,
  totalGardenScore,
  type GardenBloom,
} from "./model";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const friendReader = createFriendReader();
const RING_CELLS = [1, 2, 3, 4, 8, 12, 16, 15, 14, 13, 9, 5] as const;
type Menu = "shop" | "collection" | "activity" | "rules" | "settings" | "reveal" | "plot" | null;

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "The preview action failed.";

function BloomGlyph({ outcomeId, large = false }: Readonly<{ outcomeId: number; large?: boolean }>) {
  const bloom = BLOOMS[outcomeId - 1] ?? BLOOMS[0];
  return <svg className={`signal-bloom signal-bloom-${bloom.tone}${large ? " signal-bloom-large" : ""}`}
    viewBox="0 0 64 64" aria-hidden="true">
    {outcomeId === 1 ? <>
      <path d="M32 51V27M31 37C22 36 17 31 15 23c9-1 15 3 17 11M33 34c2-8 8-12 17-11-2 8-7 13-17 14" />
      <circle cx="32" cy="21" r="8" />
    </> : outcomeId === 2 ? <>
      <g className="signal-petals"><ellipse cx="32" cy="13" rx="6" ry="11"/><ellipse cx="32" cy="51" rx="6" ry="11"/>
        <ellipse cx="13" cy="32" rx="11" ry="6"/><ellipse cx="51" cy="32" rx="11" ry="6"/>
        <ellipse cx="18.5" cy="18.5" rx="6" ry="11" transform="rotate(-45 18.5 18.5)"/>
        <ellipse cx="45.5" cy="45.5" rx="6" ry="11" transform="rotate(-45 45.5 45.5)"/>
        <ellipse cx="45.5" cy="18.5" rx="6" ry="11" transform="rotate(45 45.5 18.5)"/>
        <ellipse cx="18.5" cy="45.5" rx="6" ry="11" transform="rotate(45 18.5 45.5)"/></g>
      <circle cx="32" cy="32" r="9" />
    </> : outcomeId === 3 ? <>
      <path d="M32 5 52 24 40 56 18 56 10 25Z" />
      <path className="signal-cut" d="M32 5 32 49M10 25 52 24M18 56 32 28 40 56" />
    </> : <>
      <path d="m32 4 7 18 20 1-15 13 5 20-17-11-17 11 5-20L5 23l20-1Z" />
      <circle className="signal-core" cx="32" cy="32" r="7" />
    </>}
  </svg>;
}

function FriendPortrait({ sprites, reducedMotion, bloomCount }: Readonly<{
  sprites: GenerationSprites;
  reducedMotion: boolean;
  bloomCount: number;
}>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current, ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    let animation = 0;
    const paint = (now: number) => {
      ctx.clearRect(0, 0, 192, 192);
      const pulse = reducedMotion ? 0 : Math.sin(now / 650) * 2;
      ctx.save();
      ctx.translate(96, 96);
      ctx.strokeStyle = "rgba(206,255,63,.35)";
      ctx.lineWidth = 2;
      for (let ring = 0; ring < Math.min(3, Math.ceil(bloomCount / 4)); ring++) {
        ctx.beginPath();
        ctx.arc(0, 0, 55 + ring * 10 + pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      const frame = reducedMotion ? 0 : Math.floor(now / 170) % 8;
      const rows = spriteFrame(sprites, "down", false, frame).frame.rows;
      const scale = 8, left = 96 - 8 * scale, top = 96 - 8 * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.shadowColor = "rgba(76,221,255,.72)";
      ctx.shadowBlur = 16 + pulse;
      ctx.fillStyle = "#f6f4ec";
      rows.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel === "#") ctx.fillRect(left + x * scale, top + y * scale, scale, scale);
      }));
      ctx.shadowBlur = 0;
      if (!reducedMotion) animation = requestAnimationFrame(paint);
    };
    paint(0);
    return () => cancelAnimationFrame(animation);
  }, [sprites, reducedMotion, bloomCount]);
  return <canvas ref={canvas} width="192" height="192" role="img"
    aria-label={`${sprites.familyName} Rare Friend, animated from its canonical on-chain sprite`} />;
}

/** A personalized, session-local garden. The SDK owns identity, balances and action confirmations. */
export default function SignalGarden({ friendId, client, paused }: GameComponentProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [sprites, setSprites] = useState<GenerationSprites | null>(null);
  const [plots, setPlots] = useState<(GardenBloom | null)[]>(() => Array.from({ length: PLOT_COUNT }, () => null));
  const [menu, setMenu] = useState<Menu>(null);
  const [selectedPlot, setSelectedPlot] = useState<number | null>(null);
  const [pendingPlot, setPendingPlot] = useState<number | null>(null);
  const [result, setResult] = useState<GamePlay | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncRequired, setSyncRequired] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [revision, setRevision] = useState(0);
  const locked = useRef(false), epoch = useRef(0);
  const deferredAfter = useRef<((state: GameSnapshot) => void) | null>(null);
  const definition = client.definition;

  useEffect(() => {
    const version = ++epoch.current;
    locked.current = false;
    setSnapshot(null); setSprites(null); setMenu(null); setSelectedPlot(null); setPendingPlot(null); setResult(null);
    deferredAfter.current = null;
    setBusy(false); setSyncRequired(false); setError(""); setMessage("");
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference(); preference.addEventListener("change", updatePreference);
    void Promise.all([client.read(), friendReader.read(friendId)]).then(([state, artwork]) => {
      if (version !== epoch.current) return;
      if (state.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      setSnapshot(state); setSprites(artwork); setPlots(gardenFromInventory(state.inventory));
    }).catch(cause => { if (version === epoch.current) setError(errorMessage(cause)); });
    return () => { epoch.current++; preference.removeEventListener("change", updatePreference); };
  }, [client, friendId, revision]);

  async function readWithRetry() {
    try { return await client.read(); }
    catch { return client.read(); }
  }

  function applyVerifiedState(state: GameSnapshot, recoveryPlot: number | null = null) {
    if (state.friendId !== friendId) throw new Error("Verified state belongs to a different Friend.");
    setSnapshot(state);
    if (!state.plays.some(play => play.outcomeId === null)) setPendingPlot(null);
    const deferred = deferredAfter.current;
    deferredAfter.current = null;
    if (deferred) deferred(state);
    else setPlots(current => reconcileGardenWithInventory(current, state.inventory, recoveryPlot));
    setSyncRequired(false);
  }

  async function refreshVerifiedState() {
    if (locked.current || paused) return;
    const version = epoch.current;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const state = await readWithRetry();
      if (version === epoch.current) {
        applyVerifiedState(state, pendingPlot);
        setMessage("Verified state refreshed.");
      }
    } catch {
      if (version === epoch.current) {
        setSyncRequired(true);
        setError("Verified state is still unavailable. No further economy action will run until refresh succeeds.");
      }
    } finally {
      if (version === epoch.current) { locked.current = false; setBusy(false); }
    }
  }

  async function act<T>(
    work: () => Promise<T>,
    after?: (output: T, state: GameSnapshot) => void,
    recoveryPlot: number | null = null,
  ) {
    if (locked.current || paused || syncRequired) return;
    const version = epoch.current;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      let output: T;
      try {
        output = await work();
        deferredAfter.current = after ? state => after(output, state) : null;
      } catch (cause) {
        deferredAfter.current = null;
        try {
          const state = await readWithRetry();
          if (version === epoch.current) applyVerifiedState(state, recoveryPlot);
        } catch {
          if (version === epoch.current) setSyncRequired(true);
        }
        if (version === epoch.current) setError(errorMessage(cause));
        return;
      }

      try {
        const state = await readWithRetry();
        if (version === epoch.current) applyVerifiedState(state, recoveryPlot);
      } catch {
        if (version === epoch.current) {
          setSyncRequired(true);
          setError("The action may have completed, but its latest state could not be verified. Refresh state before continuing.");
        }
      }
    } finally {
      if (version === epoch.current) { locked.current = false; setBusy(false); }
    }
  }

  if (!snapshot || !sprites) return <div className="signal-loading" role={error ? "alert" : "status"}>
    <span className="signal-loader" aria-hidden="true" />
    <strong>{error ? "The garden could not tune in." : "Tuning your Friend's signal…"}</strong>
    <small>{error || "Reading the verified Friend and its canonical artwork."}</small>
    {error && <button type="button" disabled={paused} onClick={() => setRevision(value => value + 1)}>Retry</button>}
  </div>;

  const pending = snapshot.plays.find(play => play.outcomeId === null);
  const currencyLabel = snapshot.mode === "preview" ? "sim RF" : "RF";
  const displayRf = (value: bigint) => `${formatGameAmount(value, 18)} ${currencyLabel}`;
  const maxPrize = maximumPrize(definition);
  const expectedHarvest = expectedReward(definition);
  const emptyCount = plots.filter(plot => !plot).length;
  const totalBlooms = plots.length - emptyCount;
  const canBuy = emptyCount > 0 && snapshot.rfBalance >= definition.price && snapshot.freeStake >= maxPrize &&
    snapshot.freeStake + definition.price >= maxPrize;
  const affinity = BLOOMS[affinityIndex(sprites.familyId)];
  const anchors = signalPlots(sprites.seed);
  const score = totalGardenScore(plots, sprites.familyId, sprites.seed);
  const acquiredSeeds = BigInt(snapshot.plays.length) + snapshot.consumables;
  const sessionSpend = acquiredSeeds * definition.price;
  const proposedBurn = sessionSpend / 10n;
  const proposedVault = sessionSpend / 20n;
  const settledSignals = snapshot.plays.filter(play => play.outcomeId !== null).length;
  const discoveredBloomCount = new Set(snapshot.plays.flatMap(play => play.outcomeId ? [play.outcomeId] : [])).size;
  const resonance = settledSignals >= 15 ? { name: "EVERGREEN", next: null } :
    settledSignals >= 12 ? { name: "HARMONIC", next: 15 } :
    settledSignals >= 6 ? { name: "RADIANT", next: 12 } :
    settledSignals >= 3 ? { name: "TUNED", next: 6 } : { name: "AWAKENING", next: 3 };
  const signalsToNext = resonance.next === null ? 0 : resonance.next - settledSignals;
  const selectedBloom = selectedPlot === null ? null : plots[selectedPlot];
  const revealedOutcome = result?.outcomeId ? definition.outcomes[result.outcomeId - 1] : null;

  const navigate = (next: Menu) => {
    if (locked.current || busy || paused) return;
    setMenu(next); setError(""); setMessage("");
  };
  const inform = (text: string) => { setError(""); setMessage(text); };
  const buySeed = () => void act(() => client.buy(1n), () => {
    setMessage("One simulated Signal Seed is ready. Choose an empty plot.");
    setMenu(null);
  });
  const plant = (plotIndex: number) => {
    if (locked.current || paused || syncRequired) return;
    setPendingPlot(plotIndex);
    void act(async () => {
      const play = pending ?? (await client.play(1n))[0];
      return client.settle(play.id);
    }, settled => {
      if (settled.outcomeId === null) {
        setMessage("The signal is pending. Resume it without spending another seed.");
        setMenu(null);
        return;
      }
      setPlots(current => current.map((plot, index) => index === plotIndex ? {
        outcomeId: settled.outcomeId!, playId: settled.id.toString(),
      } : plot));
      setPendingPlot(null);
      setSelectedPlot(plotIndex); setResult(settled); setMenu("reveal");
    }, plotIndex);
  };
  const harvest = (plotIndex: number, outcomeId: number) => void act(
    () => client.redeem(outcomeId, 1n),
    () => {
      setPlots(current => current.map((plot, index) => index === plotIndex ? null : plot));
      setMessage(`${BLOOMS[outcomeId - 1]?.name ?? "Bloom"} harvested back to simulated RF.`);
      setResult(null); setSelectedPlot(null); setMenu(null);
    },
    plotIndex,
  );
  const clickPlot = (plotIndex: number) => {
    if (locked.current || busy || paused || syncRequired) return;
    const bloom = plots[plotIndex];
    setSelectedPlot(plotIndex);
    if (bloom) { setMenu("plot"); return; }
    if (pending && pendingPlot !== null && plotIndex !== pendingPlot) {
      inform(`The pending signal belongs to plot ${pendingPlot + 1}. Resume it there.`);
      return;
    }
    if (pending || snapshot.consumables > 0n) plant(pendingPlot ?? plotIndex);
    else setMenu("shop");
  };
  const firstEmpty = plots.findIndex(plot => !plot);
  const status = error || message || (syncRequired ? "Verified state must be refreshed before another economy action." :
    busy ? "Waiting for preview confirmation…" :
    pending && pendingPlot !== null ? `Signal pending for plot ${pendingPlot + 1}. Resume it—no second seed is spent.` :
    pending ? "A signal is pending. Choose an empty plot to resume it—no second seed is spent." :
    snapshot.consumables > 0n ? "Seed ready. Choose an empty plot." :
    emptyCount === 0 ? "Garden full. Harvest a bloom to reopen a plot." :
    "Buy a seed, then choose where it grows.");
  const menuTitle = menu === "shop" ? "Signal Seed exchange" : menu === "collection" ? "Bloom collection" :
    menu === "activity" ? "Token activity receipt" : menu === "rules" ? "How the garden works" : menu === "settings" ? "Garden settings" :
    menu === "reveal" ? "A new signal bloomed" : "Plot memory";

  return <section className={`signal-game${reducedMotion ? " signal-reduced" : ""}`}
    aria-label={definition.name} aria-busy={busy}>
    <header className="signal-header">
      <div className="signal-brand"><span aria-hidden="true">✦</span><div><strong>SIGNAL GARDEN</strong><small>Friend #{friendId.toString()}</small></div></div>
      <div className="signal-metrics" aria-label="Garden status">
        <span><small>{snapshot.mode === "preview" ? "SIM RF" : "RF"}</small><strong>{formatGameAmount(snapshot.rfBalance, 18)}</strong></span>
        <span><small>SEEDS</small><strong>{snapshot.consumables.toString()}</strong></span>
        <span><small>{snapshot.mode === "preview" ? "SIM RF SPENT" : "RF SPENT"}</small><strong>{formatGameAmount(sessionSpend, 18)}</strong></span>
      </div>
      <button type="button" disabled={busy || paused} onClick={() => navigate("rules")}>Guide</button>
      <button type="button" disabled={busy || paused} aria-label="Settings" onClick={() => navigate("settings")}>···</button>
    </header>

    <main className="signal-stage" inert={Boolean(menu) || paused || undefined}>
      <div className="signal-orbit signal-orbit-one" aria-hidden="true" />
      <div className="signal-orbit signal-orbit-two" aria-hidden="true" />
      <div className="signal-grid" aria-label="Twelve garden plots">
        {RING_CELLS.map((cell, plotIndex) => {
          const bloom = plots[plotIndex], meta = bloom ? BLOOMS[bloom.outcomeId - 1] : null;
          const column = (cell - 1) % 4 + 1, row = Math.floor((cell - 1) / 4) + 1;
          const anchor = anchors.includes(plotIndex);
          return <button type="button" key={plotIndex} data-testid={`plot-${plotIndex + 1}`}
            className={`signal-plot ${bloom ? `signal-filled signal-tone-${meta?.tone}` : "signal-empty"}${anchor ? " signal-anchor" : ""}`}
            style={{ gridColumn: column, gridRow: row }} disabled={busy || paused || syncRequired}
            aria-label={bloom ? `Plot ${plotIndex + 1}, ${meta?.name}, inspect` :
              `Plot ${plotIndex + 1}, empty${anchor ? ", signal plot" : ""}, plant here`}
            onClick={() => clickPlot(plotIndex)}>
            {anchor && <span className="signal-anchor-dot" title="Friend signal plot" />}
            {bloom ? <><BloomGlyph outcomeId={bloom.outcomeId}/><small>{meta?.short}</small></> : <><span className="signal-plus">+</span><small>{plotIndex + 1}</small></>}
          </button>;
        })}
      </div>
      <div className="signal-friend-card">
        <span className="signal-family">{sprites.familyName}</span>
        <FriendPortrait sprites={sprites} reducedMotion={reducedMotion} bloomCount={totalBlooms}/>
        <div className="signal-identity"><strong>Friend #{friendId.toString()}</strong><small>affinity · {affinity.name}</small></div>
      </div>
      <div className="signal-score-card"><small>HARMONY</small><strong>{score}</strong><p>{totalBlooms}/12 blooms · {emptyCount ? `${emptyCount} open` : "complete"}</p>
        <div className="signal-resonance"><small>RESONANCE</small><strong>{resonance.name}</strong>
          <em>{resonance.next === null ? "peak session tier" : `${signalsToNext} signal${signalsToNext === 1 ? "" : "s"} to next`}</em></div>
      </div>
    </main>

    <footer className="signal-dock">
      <button type="button" disabled={busy || paused} onClick={() => navigate("collection")}><span>Collection</span><strong>{discoveredBloomCount}/4</strong></button>
      <div className="signal-action">
        <button type="button" className="signal-primary"
          disabled={busy || paused || (!syncRequired && firstEmpty < 0)}
          onClick={() => syncRequired ? void refreshVerifiedState() :
            pending && pendingPlot !== null ? plant(pendingPlot) :
            pending ? inform("Choose an empty plot to place the pending signal.") :
            snapshot.consumables > 0n ? inform("Choose any empty plot around your Friend.") : navigate("shop")}>
          {syncRequired ? "Refresh state" : pending && pendingPlot !== null ? "Resume signal" :
            pending ? "Choose resume plot" : snapshot.consumables > 0n ? "Choose a plot" :
            firstEmpty < 0 ? "Garden full" : `Buy a seed · 1 ${currencyLabel}`}
        </button>
        <p className={error ? "signal-error" : ""} role={error ? "alert" : "status"} aria-live="polite">{status}</p>
      </div>
      <button type="button" className="signal-model" disabled={busy || paused} onClick={() => navigate("activity")}
        aria-label={`Open token activity receipt, ${displayRf(sessionSpend)} spent`}>
        <span>{snapshot.mode === "preview" ? "SIMULATED ACTIVITY" : "RF ACTIVITY"}</span><small>{displayRf(sessionSpend)} spent · 10% burn + 5% vault proposed</small>
      </button>
    </footer>

    {menu && <GameMenu title={menuTitle} onClose={busy ? undefined : () => navigate(null)}>
      {menu === "shop" ? <div className="signal-menu">
        <p>Each Signal Seed costs <strong>{displayRf(definition.price)}</strong>. Planting consumes one seed and reveals one redeemable bloom.</p>
        <table><thead><tr><th>Bloom</th><th>Chance</th><th>Harvest</th></tr></thead><tbody>
          {definition.outcomes.map((outcome, index) => <tr key={outcome.name}><td><BloomGlyph outcomeId={index + 1}/>{outcome.name}</td>
            <td>{outcome.chanceBps / 100}%</td><td>{displayRf(outcome.reward)}</td></tr>)}
        </tbody></table>
        <button type="button" className="rf-frame-primary" disabled={!canBuy || busy || paused || syncRequired} onClick={buySeed}>Buy one Signal Seed · {displayRf(definition.price)}</button>
        {!canBuy && <p>{emptyCount === 0 ? "Harvest a bloom to open a plot first." : snapshot.rfBalance < definition.price ?
          "Not enough simulated RF." : "New seeds are paused until the reward reserve has room."}</p>}
        <small>Every seed reserves {displayRf(maxPrize)}. Expected harvest value is {displayRf(expectedHarvest)}. The 10% burn + 5% seasonal-vault split is a Signal Garden prototype model, not a claim about current Rare Friends protocol routing.</small>
      </div> : menu === "reveal" && result?.outcomeId && revealedOutcome && selectedPlot !== null ? <div className="signal-reveal">
        <div className="signal-reveal-art"><BloomGlyph outcomeId={result.outcomeId} large/><span className="signal-rays" aria-hidden="true"/></div>
        <small>PLOT {selectedPlot + 1} · {revealedOutcome.chanceBps / 100}% SIGNAL</small>
        <h3>{revealedOutcome.name}</h3>
        <p>{BLOOMS[result.outcomeId - 1]?.lore}</p>
        <p className="signal-reveal-score">+{bloomScore(result.outcomeId, selectedPlot, sprites.familyId, sprites.seed)} harmony · {displayRf(revealedOutcome.reward)} harvest value</p>
        <div className="signal-menu-actions"><button type="button" className="rf-frame-primary" disabled={busy || paused} onClick={() => navigate(null)}>Keep in garden</button>
          <button type="button" disabled={busy || paused || syncRequired} onClick={() => harvest(selectedPlot, result.outcomeId!)}>Harvest · {displayRf(revealedOutcome.reward)}</button></div>
      </div> : menu === "plot" && selectedBloom && selectedPlot !== null ? <div className="signal-inspect">
        <BloomGlyph outcomeId={selectedBloom.outcomeId} large/>
        <small>PLOT {selectedPlot + 1}{anchors.includes(selectedPlot) ? " · SIGNAL PLOT" : ""}</small>
        <h3>{BLOOMS[selectedBloom.outcomeId - 1]?.name}</h3>
        <p>{BLOOMS[selectedBloom.outcomeId - 1]?.lore}</p>
        <p>This bloom contributes <strong>{bloomScore(selectedBloom.outcomeId, selectedPlot, sprites.familyId, sprites.seed)} harmony</strong> and can be harvested for <strong>{displayRf(definition.outcomes[selectedBloom.outcomeId - 1].reward)}</strong>.</p>
        <button type="button" disabled={busy || paused || syncRequired} onClick={() => harvest(selectedPlot, selectedBloom.outcomeId)}>Harvest bloom</button>
      </div> : menu === "collection" ? <div className="signal-menu">
        <p>Discover all four bloom signals in one runtime session. Discovery remains recorded after harvest; kept blooms stay backed at their fixed simulated RF value with no expiry.</p>
        <div className="signal-collection">{definition.outcomes.map((outcome, index) => {
          const plotIndex = plots.findIndex(plot => plot?.outcomeId === index + 1);
          const discovered = snapshot.plays.some(play => play.outcomeId === index + 1);
          return <div key={outcome.name} className={discovered ? "signal-discovered" : "signal-undiscovered"}><BloomGlyph outcomeId={index + 1}/><span><strong>{outcome.name}</strong><small>{discovered ? "discovered" : "undiscovered"} · {snapshot.inventory[index].toString()} kept · {displayRf(outcome.reward)} each</small></span>
            <button type="button" disabled={busy || paused || syncRequired || snapshot.inventory[index] === 0n} onClick={() => {
              if (plotIndex >= 0) harvest(plotIndex, index + 1);
              else void act(() => client.redeem(index + 1, 1n), () => setMessage(`${outcome.name} harvested.`));
            }}>Harvest one</button></div>;
        })}</div>
      </div> : menu === "activity" ? <div className="signal-menu signal-activity">
        <p>Each acquired Signal Seed records 1 {currencyLabel} of repeat activity. Harvesting reopens a scarce plot, so the same Friend can keep growing without erasing prior spend.</p>
        <div className="signal-activity-total"><small>{snapshot.mode === "preview" ? "SIMULATED SESSION SPEND" : "RECORDED RF SPEND"}</small><strong>{displayRf(sessionSpend)}</strong></div>
        <div className="signal-activity-grid">
          <div><small>SEEDS ACQUIRED</small><strong>{acquiredSeeds.toString()}</strong></div>
          <div><small>SIGNALS PLANTED</small><strong>{snapshot.plays.length}</strong></div>
          <div><small>SG MODEL BURN · 10%</small><strong>{displayRf(proposedBurn)}</strong></div>
          <div><small>SG MODEL VAULT · 5%</small><strong>{displayRf(proposedVault)}</strong></div>
        </div>
        <div className="signal-session-goals">
          <div><small>SESSION RESONANCE</small><strong>{resonance.name}</strong>
            <span>{resonance.next === null ? "Peak session tier reached." : `${signalsToNext} more settled signal${signalsToNext === 1 ? "" : "s"} to the next tier.`}</span></div>
          <div><small>BLOOMS DISCOVERED</small><strong>{discoveredBloomCount}/4</strong>
            <span>Discovery survives harvest for this runtime session.</span></div>
        </div>
        <p className="signal-activity-note"><strong>Signal Garden model only.</strong> The preview spends no live RF and performs no burn or vault transfer. Current Rare Friends public docs describe general gameplay payments as 50% burn / 50% rewards; this entry's 10% burn + 5% vault concept is not current protocol routing. Any live version must be redesigned and reviewed against the then-current rules, with every reward fully funded and explicit wallet confirmations.</p>
      </div> : menu === "rules" ? <div className="signal-menu signal-rules">
        <p><strong>1.</strong> Buy a {displayRf(definition.price)} Signal Seed. <strong>2.</strong> Choose an empty plot. <strong>3.</strong> Keep the revealed bloom for harmony, or harvest its fixed {currencyLabel} value.</p>
        <p>Your verified <strong>{sprites.familyName} Friend #{friendId.toString()}</strong> is the heart of this garden. Its on-chain family makes <strong>{affinity.name}</strong> its affinity; its seed marks three glowing signal plots. Affinity blooms and signal plots add non-financial harmony bonuses. They never change the published RF odds.</p>
        <p>A full garden has twelve blooms. Harvesting opens a plot so the loop can continue. Bloom discovery remains recorded after harvest, and session resonance advances at 3, 6, 12 and 15 settled signals. These goals are non-financial and never change odds or rewards.</p>
        <p>The garden layout, discovery and resonance are session-local; a full runtime reload resets them. The SDK ledger retains kept items only during the runtime session.</p>
        <p><strong>Everything is simulated.</strong> No RF, signature or transaction is used in this preview. A production version would require a reviewed contract and explicit wallet confirmations.</p>
        <div className="signal-menu-actions">
          <button type="button" onClick={() => navigate("collection")}>View collection</button>
          <button type="button" onClick={() => navigate("activity")}>View activity receipt</button>
        </div>
      </div> : menu === "settings" ? <div className="signal-menu">
        <label><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)}/> Reduce motion</label>
        <p>Signal Garden is silent by design. Reduced motion freezes the Friend's idle animation, orbit pulses and bloom effects.</p>
        <p>Wallet connection, eligible Friend selection and fresh ownership verification are supplied by FriendSDK v0.1.2. The game cannot access a signer.</p>
        <p>Reloading the full runtime resets the simulated preview. Reloading only the game frame rebuilds visible plots from the host-owned inventory.</p>
      </div> : null}
      {(error || busy) && <p className={error ? "signal-menu-error" : ""} role={error ? "alert" : "status"}>{error || "Waiting for preview confirmation…"}</p>}
      {syncRequired && !busy && <button type="button" className="rf-frame-primary" onClick={() => { void refreshVerifiedState(); }}>Refresh verified state</button>}
    </GameMenu>}
  </section>;
}
