/* Bombu (Le Barbu) game-screen UI, modelled on Contrée: the chooser first picks
   the deal's contract (stored on game.pendingContract, like a Contrée bid), then
   the board shows it with "Saisir les scores" / "Modifier le contrat". Entering
   the four scores commits the round { chooser, contract, scores } and clears the
   pending contract; the game auto-ends once every player has played all 7. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { BOMBU_CONTRACTS, bombuContract, bombuTaken } from "../rules.js";
import { bombuChooser, winner } from "../scoring.js";
import { go } from "../nav.js";
import { celebrateIfNewWinner } from "./celebrate.js";

// Card above the scoreboard: who chooses this deal and, once picked, the active
// contract with its score badge.
function buildBombuContractInfo(game) {
  const chooser = bombuChooser(game);
  const c = bombuContract(game.pendingContract);
  const contract = c
    ? `<span class="bid-current"><b>${esc(c.label)}</b> · <span class="muted">${esc(c.badge)}</span></span>`
    : "";
  return el(`
    <div class="bid-info">
      <span class="bid-dealer"><i class="fa-regular fa-hand-pointer"></i> En main : <b>${esc(chooser ? chooser.name : "")}</b></span>
      ${contract}
    </div>`);
}

// Action bar: pick who starts, then choose the contract → enter the scores.
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
  if (game.pendingContract) {
    // Contract chosen — shown in the card above; enter the scores or change it.
    const bar = el(`
      <div class="new-scores-bar turn-bar">
        <button class="btn btn-primary btn-big" id="bombuScores"><i class="fa-regular fa-plus"></i> Saisir les scores</button>
        <button class="btn btn-ghost btn-big btn-end" id="bombuEditContract"><i class="fa-regular fa-pen"></i> Contrat</button>
      </div>`);
    bar
      .querySelector("#bombuScores")
      .addEventListener("click", () => openBombuScoreDialog(game));
    bar
      .querySelector("#bombuEditContract")
      .addEventListener("click", () => openBombuContractDialog(game));
    wrap.appendChild(bar);
  } else {
    const chooser = bombuChooser(game);
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="bombuPick"><i class="fa-regular fa-list-check"></i> Choisir le contrat — ${esc(chooser ? chooser.name : "")}</button></div>`,
    );
    bar
      .querySelector("#bombuPick")
      .addEventListener("click", () => openBombuContractDialog(game));
    wrap.appendChild(bar);
  }
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

// Step 1: the chooser picks a contract (among those left on their card). Stored
// on game.pendingContract; returns to the board.
function openBombuContractDialog(game) {
  const chooser = bombuChooser(game);
  if (!chooser) return;
  const turnNo = game.rounds.length + 1;
  const taken = bombuTaken(game, chooser.id);
  let selKey =
    game.pendingContract && !taken.has(game.pendingContract)
      ? game.pendingContract
      : null;

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Manche ${turnNo} — ${esc(chooser.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta"><b>${esc(chooser.name)}</b> choisit le contrat</div>
      <div class="yams-missions" id="bombuContracts"></div>
      <div class="bombu-note muted" id="bombuNote" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="bombuValidate"${selKey ? "" : " disabled"}>Valider le contrat</button>
    </div>`;
  const contractsEl = modal.querySelector("#bombuContracts");
  const noteEl = modal.querySelector("#bombuNote");
  const validateBtn = modal.querySelector("#bombuValidate");

  const syncSel = () => {
    contractsEl
      .querySelectorAll(".bombu-contract")
      .forEach((b) => b.classList.toggle("active", b.dataset.key === selKey));
    const c = bombuContract(selKey);
    noteEl.hidden = !c;
    if (c) noteEl.textContent = c.note;
    validateBtn.disabled = !selKey;
  };
  BOMBU_CONTRACTS.forEach((c) => {
    const done = taken.has(c.key);
    const btn = el(
      `<button type="button" class="yams-mission yams-lower bombu-contract${done ? " filled" : ""}" data-key="${c.key}"${done ? " disabled" : ""}><span class="yams-mission-name">${esc(c.label)}</span><span class="yams-fixed">${esc(c.badge)}</span></button>`,
    );
    if (!done) btn.addEventListener("click", () => { selKey = c.key; syncSel(); });
    contractsEl.appendChild(btn);
  });
  syncSel();

  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) =>
    b.addEventListener("click", close),
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  validateBtn.addEventListener("click", () => {
    if (!selKey) return toast("Choisissez un contrat");
    const g = getGame(game.id);
    g.pendingContract = selKey;
    upsertGame(g);
    overlay.remove();
    go("game", { id: game.id });
  });
  root.appendChild(overlay);
}

// Step 2: enter the four players' scores for the active contract, then commit
// the deal and clear the pending contract.
function openBombuScoreDialog(game) {
  const chooser = bombuChooser(game);
  const c = bombuContract(game.pendingContract);
  if (!chooser || !c) return;
  const m = c.entry || { mode: "free" };
  const turnNo = game.rounds.length + 1;
  // State, by mode: count/free/rank keep a per-player value; "who" keeps the id
  // of the single player who took the penalty (8 pts).
  const vals = {};
  game.players.forEach((p) => (vals[p.id] = ""));
  let whoPid = null;

  // Resolved points for a player given the current entry state.
  const pointsFor = (pid) => {
    if (m.mode === "count") return (Number(vals[pid]) || 0) * m.per;
    if (m.mode === "who") return whoPid === pid ? m.value : 0;
    return Number(vals[pid]) || 0; // rank / free: the value is the points
  };

  // Per-mode instruction shown under the title.
  const hint =
    m.mode === "count"
      ? `Nombre de ${esc(m.unit)} par joueur (× ${m.per})`
      : m.mode === "who"
        ? esc(m.ask)
        : m.mode === "rank"
          ? "Place de chaque joueur"
          : "Saisie libre";

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Manche ${turnNo} — ${esc(c.label)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">${hint}</div>
      <div class="entry-grid" id="bombuScores"></div>
      <div class="bombu-check" id="bombuCheck"></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveBombu">Enregistrer</button>
    </div>`;
  const scoresEl = modal.querySelector("#bombuScores");
  const checkEl = modal.querySelector("#bombuCheck");

  // Compare the entered total against the contract's theoretical total and warn
  // if it overshoots or is still incomplete.
  const updateMsg = () => {
    if (typeof c.total !== "number") {
      checkEl.textContent = "";
      checkEl.className = "bombu-check";
      return;
    }
    const sum = game.players.reduce((s, p) => s + pointsFor(p.id), 0);
    const over = c.total >= 0 ? sum > c.total : sum < c.total;
    const under = c.total >= 0 ? sum < c.total : sum > c.total;
    if (over) {
      checkEl.textContent = `⚠ Total trop élevé : ${sum} (théorique ${c.total})`;
      checkEl.className = "bombu-check over";
    } else if (under) {
      checkEl.textContent = `Il manque des points : ${sum} / ${c.total}`;
      checkEl.className = "bombu-check under";
    } else {
      checkEl.textContent = `✓ Total correct (${sum})`;
      checkEl.className = "bombu-check ok";
    }
  };

  // Render the per-player controls for the contract's entry mode.
  const renderRows = () => {
    scoresEl.innerHTML = "";
    game.players.forEach((p) => {
      const row = el(
        `<div class="entry-player"><span class="pname">${esc(p.name)}</span><div class="entry-controls"></div></div>`,
      );
      const ctr = row.querySelector(".entry-controls");
      if (m.mode === "count" || m.mode === "free") {
        ctr.innerHTML = `<input type="number" inputmode="numeric" class="cell-input"${m.mode === "count" ? ' min="0"' : ""} placeholder="0" value="${esc(vals[p.id])}" />${m.mode === "count" ? `<span class="bombu-pts muted">= ${pointsFor(p.id)} pts</span>` : ""}`;
        const input = ctr.querySelector("input");
        input.addEventListener("input", () => {
          vals[p.id] = input.value;
          const pts = ctr.querySelector(".bombu-pts");
          if (pts) pts.textContent = `= ${pointsFor(p.id)} pts`;
          updateMsg();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") save();
        });
      } else if (m.mode === "rank") {
        ctr.classList.add("bombu-rank");
        ctr.innerHTML = m.values
          .map(
            (v) =>
              `<button type="button" class="btn btn-ghost btn-sm bombu-rank-btn${String(vals[p.id]) === String(v) ? " active" : ""}" data-val="${v}">${v > 0 ? "+" + v : v}</button>`,
          )
          .join("");
        ctr.querySelectorAll(".bombu-rank-btn").forEach((b) =>
          b.addEventListener("click", () => {
            const v = Number(b.dataset.val);
            vals[p.id] = v;
            // Keep the four values distinct (each place taken once).
            game.players.forEach((q) => {
              if (q.id !== p.id && Number(vals[q.id]) === v && vals[q.id] !== "")
                vals[q.id] = "";
            });
            renderRows();
          }),
        );
      } else if (m.mode === "who") {
        const on = whoPid === p.id;
        ctr.innerHTML = `<button type="button" class="btn btn-ghost btn-sm bombu-pick-btn${on ? " active" : ""}">${on ? `+${m.value} pts` : "Désigner"}</button>`;
        ctr.querySelector("button").addEventListener("click", () => {
          whoPid = on ? null : p.id;
          renderRows();
        });
      }
      scoresEl.appendChild(row);
    });
    updateMsg();
  };
  renderRows();

  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) =>
    b.addEventListener("click", close),
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const save = () => {
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = { points: pointsFor(p.id) };
    });
    const g = getGame(game.id);
    const before = (winner(g) || {}).id || null;
    g.rounds.push({
      chooser: chooser.id,
      contract: g.pendingContract,
      scores,
      at: Date.now(),
    });
    delete g.pendingContract; // deal committed — clear the active contract
    upsertGame(g);
    overlay.remove();
    toast(`Manche ${turnNo} — ${c.label} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(before, g);
  };
  modal.querySelector("#saveBombu").addEventListener("click", save);
  root.appendChild(overlay);
  const first = scoresEl.querySelector("input");
  if (first) first.focus();
}

export { buildBombuBar, buildBombuContractInfo };
