/* Turn-based score entry (Qwirkle / Yam's): the action bar, the "who starts"
   picker, and the per-turn dialog. Yam's delegates to its own dialog. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { defFor } from "../rules.js";
import { currentPlayer, turnDraftHasData } from "../scoring.js";
import { go, currentRoute } from "../nav.js";
import { endGamePrompt } from "../actions.js";
import { openYamsDialog } from "./yams.js";

function buildTurnBar(game) {
  const started = !!game.starter;
  const cur = currentPlayer(game);
  const canEnd = game.rounds.length > 0;
  const hasDraft = turnDraftHasData(game.draftTurn);
  const scoreBtnHtml =
    started && cur
      ? `<button class="btn btn-primary btn-big" id="turnScore"><i class="fa-regular fa-${hasDraft ? "pen-to-square" : "plus"}"></i> ${hasDraft ? `Reprendre — ${esc(cur.name)}` : `Score de ${esc(cur.name)}`}</button>`
      : `<button class="btn btn-primary btn-big" id="startGame"><i class="fa-regular fa-flag"></i> Qui commence ?</button>`;
  const bar = el(`
    <div class="new-scores-bar turn-bar">
      ${scoreBtnHtml}
      ${canEnd ? `<button class="btn btn-ghost btn-big btn-end" id="endGameBar"><i class="fa-regular fa-flag-checkered"></i> Terminer</button>` : ""}
    </div>`);
  const startBtn = bar.querySelector("#startGame");
  if (startBtn)
    startBtn.addEventListener("click", () => openStarterDialog(game));
  const scoreBtn = bar.querySelector("#turnScore");
  if (scoreBtn)
    scoreBtn.addEventListener("click", () =>
      defFor(game).entry === "yams"
        ? openYamsDialog(game)
        : openTurnDialog(game),
    );
  const endBtn = bar.querySelector("#endGameBar");
  if (endBtn) endBtn.addEventListener("click", () => endGamePrompt(game));
  return bar;
}

// Pick which player starts; the turn order then follows the roster from there.
function openStarterDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Qui commence ?</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <p class="rules-intro">Choisissez le joueur qui débute. Les tours s'enchaîneront ensuite dans l'ordre des joueurs.</p>
      <div class="starter-list" id="starterList"></div>
    </div>`;
  const list = modal.querySelector("#starterList");
  game.players.forEach((p) => {
    const btn = el(
      `<button class="btn btn-ghost starter-item">${esc(p.name)}</button>`,
    );
    btn.addEventListener("click", () => {
      const g = getGame(game.id);
      g.starter = p.id;
      upsertGame(g);
      overlay.remove();
      go("game", { id: game.id });
    });
    list.appendChild(btn);
  });
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}

// Enter the current player's score for this turn. "A pioché" records 0 points
// (the player drew/exchanged tiles instead of scoring) — same idea as Flip 7's
// "Éliminé" toggle. Saving commits a one-player round and advances the turn.
function openTurnDialog(game) {
  const cur = currentPlayer(game);
  if (!cur) return;
  const turnNo = game.rounds.length + 1;
  const saved = game.draftTurn || {};
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  let drawn = !!saved.drawn;
  const savedPoints = drawn || saved.points == null ? "" : String(saved.points);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de ${esc(cur.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">Tour ${turnNo}</div>
      <div class="entry-player turn-entry${drawn ? " busted" : ""}" id="turnEntry">
        <div class="entry-controls">
          <input type="number" class="cell-input" id="turnPoints" placeholder="0" inputmode="numeric" value="${esc(savedPoints)}" ${drawn ? "disabled" : ""} />
          <button type="button" class="btn btn-ghost btn-sm bust-btn${drawn ? " active" : ""}" id="drawnBtn">A pioché (0)</button>
        </div>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveTurn">Enregistrer</button>
    </div>`;
  const input = modal.querySelector("#turnPoints");
  const drawnBtn = modal.querySelector("#drawnBtn");
  const entry = modal.querySelector("#turnEntry");

  // Pre-save the in-progress turn to game.draftTurn (debounced), so closing and
  // reopening keeps the entry — mirrors the multi-player scores dialog.
  const hasData = () => drawn || (input.value !== "" && input.value != null);
  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftTurn = hasData() ? { points: drawn ? "" : input.value, drawn } : null;
    upsertGame(g);
  };
  let saveTimer = null;
  const saveDraftSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeDraft, 400);
  };

  drawnBtn.addEventListener("click", () => {
    drawn = !drawn;
    drawnBtn.classList.toggle("active", drawn);
    entry.classList.toggle("busted", drawn);
    input.disabled = drawn;
    if (drawn) input.value = "";
    else input.focus();
    saveDraftSoon();
  });
  input.addEventListener("input", saveDraftSoon);

  // Leaving the dialog flushes the pending pre-save so the turn can be resumed.
  const closeKeepingDraft = () => {
    clearTimeout(saveTimer);
    writeDraft();
    overlay.remove();
    if (currentRoute().name === "game" && currentRoute().id === game.id)
      go("game", { id: game.id });
  };
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", closeKeepingDraft));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  const save = () => {
    clearTimeout(saveTimer); // cancel any pending draft write
    const points = drawn ? 0 : Number(input.value) || 0;
    const cell = drawn ? { points: 0, drawn: true } : { points };
    const g = getGame(game.id);
    g.rounds.push({ scores: { [cur.id]: cell }, at: Date.now() });
    g.draftTurn = null; // turn committed — clear the draft
    upsertGame(g);
    overlay.remove();
    toast(`${cur.name} : ${drawn ? "a pioché (0)" : points + " pts"}`);
    go("game", { id: game.id });
  };
  modal.querySelector("#saveTurn").addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
  });
  root.appendChild(overlay);
  if (!drawn) input.focus();
}

/* ---------- Yams (dice scorecard) ---------- */
// Enter the current player's turn: pick a mission among those left on their
// card, set its value (auto for fixed combos like Full/suites/Yams, typed for
// the rest) or scratch it (0 pts). Saving commits a one-player round and
// advances the turn. The in-progress pick is pre-saved to game.draftTurn so the
// dialog can be closed and resumed.

export { buildTurnBar };
