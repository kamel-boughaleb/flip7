/* Bombu (Le Barbu) game-screen UI: the action bar, the "who starts" picker, and
   the per-deal dialog where the chooser picks a contract (one they haven't taken
   yet) and all four players' scores are entered. A committed round is
   { chooser, contract, scores: { [pid]: { points } } }; the game auto-ends once
   every player has played all 7 contracts. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { BOMBU_CONTRACTS, bombuContract, bombuTaken } from "../rules.js";
import { bombuChooser, winner } from "../scoring.js";
import { go, currentRoute } from "../nav.js";
import { celebrateIfNewWinner } from "./celebrate.js";

// Action bar: pick who starts, then a button to open the current deal's dialog.
function buildBombuBar(game) {
  const wrap = el(`<div class="contree-actions"></div>`);
  if (!game.starter) {
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="bombuStart"><i class="fa-regular fa-flag"></i> Qui commence ?</button></div>`,
    );
    bar
      .querySelector("#bombuStart")
      .addEventListener("click", () => openBombuStarterDialog(game));
    wrap.appendChild(bar);
    return wrap;
  }
  const chooser = bombuChooser(game);
  const turnNo = game.rounds.length + 1;
  const hasDraft = !!(game.draftTurn && game.draftTurn.contract);
  const bar = el(`
    <div class="new-scores-bar turn-bar">
      <button class="btn btn-primary btn-big" id="bombuDeal"><i class="fa-regular fa-${hasDraft ? "pen-to-square" : "plus"}"></i> ${hasDraft ? "Reprendre" : `Manche ${turnNo}`} — ${esc(chooser ? chooser.name : "")}</button>
    </div>`);
  bar
    .querySelector("#bombuDeal")
    .addEventListener("click", () => openBombuDialog(game));
  wrap.appendChild(bar);
  return wrap;
}

// Pick who chooses the first contract; the choice then rotates in roster order.
function openBombuStarterDialog(game) {
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
      <p class="rules-intro">Choisissez qui prend le premier contrat. Le choix tournera ensuite dans l'ordre des joueurs.</p>
      <div class="starter-list" id="starterList"></div>
    </div>`;
  const list = modal.querySelector("#starterList");
  game.players.forEach((p) => {
    const btn = el(`<button class="btn btn-ghost starter-item">${esc(p.name)}</button>`);
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

// The current deal: the chooser picks a contract (among those left on their
// card), then every player's score for the deal is entered. Pre-saved to
// game.draftTurn so it can be closed and resumed.
function openBombuDialog(game) {
  const chooser = bombuChooser(game);
  if (!chooser) return;
  const turnNo = game.rounds.length + 1;
  const taken = bombuTaken(game, chooser.id);
  const saved = game.draftTurn && game.draftTurn.contract ? game.draftTurn : null;
  let selKey = saved && !taken.has(saved.contract) ? saved.contract : null;
  // Per-player raw score strings.
  const vals = {};
  game.players.forEach((p) => {
    const s = saved && saved.scores ? saved.scores[p.id] : null;
    vals[p.id] = s != null && s !== "" ? String(s) : "";
  });

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  // Two steps: 1 = pick the contract, 2 = enter the four scores. Resume on
  // step 2 if a contract was already drafted.
  let step = selKey ? 2 : 1;

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3 id="bombuTitle"></h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body" id="bombuBody"></div>
    <div class="scores-dialog-foot" id="bombuFoot"></div>`;
  const titleEl = modal.querySelector("#bombuTitle");
  const bodyEl = modal.querySelector("#bombuBody");
  const footEl = modal.querySelector("#bombuFoot");

  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftTurn = selKey ? { contract: selKey, scores: { ...vals } } : null;
    upsertGame(g);
  };

  // Step 1 — contract picker (taken contracts disabled).
  function renderPick() {
    titleEl.textContent = `Manche ${turnNo} — ${chooser.name}`;
    bodyEl.innerHTML = `
      <div class="turn-meta"><b>${esc(chooser.name)}</b> choisit le contrat</div>
      <div class="yams-missions" id="bombuContracts"></div>
      <div class="bombu-note muted" id="bombuNote" hidden></div>`;
    footEl.innerHTML = `
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="bombuNext"${selKey ? "" : " disabled"}>Suivant</button>`;
    const contractsEl = bodyEl.querySelector("#bombuContracts");
    const noteEl = bodyEl.querySelector("#bombuNote");
    const nextBtn = footEl.querySelector("#bombuNext");
    const syncSel = () => {
      contractsEl
        .querySelectorAll(".bombu-contract")
        .forEach((b) => b.classList.toggle("active", b.dataset.key === selKey));
      const c = bombuContract(selKey);
      noteEl.hidden = !c;
      if (c) noteEl.textContent = c.note;
      nextBtn.disabled = !selKey;
    };
    BOMBU_CONTRACTS.forEach((c) => {
      const done = taken.has(c.key);
      const btn = el(
        `<button type="button" class="yams-mission yams-lower bombu-contract${done ? " filled" : ""}" data-key="${c.key}"${done ? " disabled" : ""}><span class="yams-mission-name">${esc(c.label)}</span><span class="yams-fixed">${esc(c.badge)}</span></button>`,
      );
      if (!done)
        btn.addEventListener("click", () => {
          selKey = c.key;
          syncSel();
          writeDraft();
        });
      contractsEl.appendChild(btn);
    });
    syncSel();
    nextBtn.addEventListener("click", () => {
      if (!selKey) return toast("Choisissez un contrat");
      step = 2;
      render();
    });
    wireClose();
  }

  // Step 2 — one score input per player (negatives allowed for the Réussite).
  function renderScores() {
    const c = bombuContract(selKey);
    titleEl.textContent = `Manche ${turnNo} — ${c ? c.label : ""}`;
    bodyEl.innerHTML = `
      <div class="turn-meta">${esc(c ? c.label : "")}${c ? ` · <span class="muted">${esc(c.note)}</span>` : ""}</div>
      <div class="entry-grid" id="bombuScores"></div>`;
    footEl.innerHTML = `
      <button class="btn btn-ghost" id="bombuBack"><i class="fa-regular fa-arrow-left"></i> Contrat</button>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="saveBombu">Enregistrer</button>`;
    const scoresEl = bodyEl.querySelector("#bombuScores");
    game.players.forEach((p) => {
      const row = el(`
        <div class="entry-player">
          <span class="pname">${esc(p.name)}</span>
          <div class="entry-controls">
            <input type="number" inputmode="numeric" class="cell-input" data-pid="${p.id}" placeholder="0" value="${esc(vals[p.id])}" />
          </div>
        </div>`);
      const input = row.querySelector("input");
      input.addEventListener("input", () => {
        vals[p.id] = input.value;
        writeDraft();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      scoresEl.appendChild(row);
    });
    footEl.querySelector("#bombuBack").addEventListener("click", () => {
      step = 1;
      render();
    });
    footEl.querySelector("#saveBombu").addEventListener("click", save);
    wireClose();
    const first = scoresEl.querySelector("input");
    if (first) first.focus();
  }

  const render = () => (step === 2 ? renderScores() : renderPick());

  const closeKeepingDraft = () => {
    writeDraft();
    overlay.remove();
    if (currentRoute().name === "game" && currentRoute().id === game.id)
      go("game", { id: game.id });
  };
  // The header ✕ persists across steps — bind it once. The footer "Annuler" is
  // rebuilt each render, so wireClose re-binds only that one.
  modal
    .querySelector(".rules-dialog-head [data-act=close]")
    .addEventListener("click", closeKeepingDraft);
  const wireClose = () =>
    footEl
      .querySelectorAll("[data-act=close]")
      .forEach((b) => b.addEventListener("click", closeKeepingDraft));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  const save = () => {
    if (!selKey) return toast("Choisissez un contrat");
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = { points: Number(vals[p.id]) || 0 };
    });
    const g = getGame(game.id);
    const before = (winner(g) || {}).id || null;
    g.rounds.push({ chooser: chooser.id, contract: selKey, scores, at: Date.now() });
    g.draftTurn = null; // deal committed — clear the draft
    upsertGame(g);
    overlay.remove();
    const c = bombuContract(selKey);
    toast(`Manche ${turnNo} — ${c ? c.label : ""} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(before, g);
  };

  render();
  root.appendChild(overlay);
}

export { buildBombuBar };
