/* Score-entry dialogs for round-based games: per-player entry rows, the
   multi-player "Nouveaux scores" dialog, and the screen-2 round editor. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { defFor } from "../rules.js";
import { winner } from "../scoring.js";
import { celebrateIfNewWinner } from "./celebrate.js";
import { go, currentRoute } from "../nav.js";

function draftHasData(d) {
  return d && ((d.points !== "" && d.points != null) || d.flip7 || d.bust);
}
// Convert a draft cell to a stored round cell, per the game's entry style.
function draftToCell(def, d) {
  if (def.entry === "number") {
    const cell = { points: Number(d.points) || 0 };
    if (def.doubling && d.doubled) cell.doubled = true; // ×2 round penalty
    return cell;
  }
  return {
    points: d.bust ? 0 : Number(d.points) || 0,
    flip7: d.bust ? false : !!d.flip7,
    bust: !!d.bust,
  };
}
// Build and wire one player's score-entry row. `draft[p.id]` must be set.
// Renders the Flip 7 controls (number + bonus + Éliminé) or, for "number"
// games like Skyjo, a single number input (negatives allowed). `onChange` (if
// given) fires after every draft mutation, e.g. to pre-save the round live.
function buildEntryRow(game, draft, p, onChange) {
  const def = defFor(game);
  const d = draft[p.id];
  const notify = () => onChange && onChange();
  if (def.entry === "number") {
    const row = el(`
      <div class="entry-player${d.doubled ? " doubled" : ""}">
        <span class="pname">${esc(p.name)}</span>
        <div class="entry-controls">
          ${def.negatives ? '<button type="button" class="btn btn-ghost btn-sm sign-btn" title="Score négatif" aria-label="Inverser le signe">±</button>' : ""}
          <input type="number" inputmode="numeric" class="cell-input" placeholder="0" value="${esc(d.points)}" />
          ${def.doubling ? `<button type="button" class="btn btn-ghost btn-sm x2-btn${d.doubled ? " active" : ""}" title="Doubler le score de la manche" aria-label="Doubler le score">×2</button>` : ""}
        </div>
      </div>`);
    const input = row.querySelector("input");
    input.addEventListener("input", (e) => {
      draft[p.id].points = e.target.value;
      notify();
    });
    const signBtn = row.querySelector(".sign-btn");
    if (signBtn)
      signBtn.addEventListener("click", () => {
        const v = String(input.value).trim();
        input.value = v.startsWith("-") ? v.slice(1) : "-" + v;
        draft[p.id].points = input.value;
        input.focus();
        notify();
      });
    const x2Btn = row.querySelector(".x2-btn");
    if (x2Btn)
      x2Btn.addEventListener("click", () => {
        draft[p.id].doubled = !draft[p.id].doubled;
        x2Btn.classList.toggle("active", draft[p.id].doubled);
        row.classList.toggle("doubled", draft[p.id].doubled);
        notify();
      });
    return row;
  }
  const row = el(`
    <div class="entry-player ${d.bust ? "busted" : d.flip7 ? "flipped" : ""}">
      <span class="pname">${esc(p.name)}</span>
      <div class="entry-controls">
        <input type="number" inputmode="numeric" class="cell-input" placeholder="0" min="0" value="${d.bust ? "" : esc(d.points)}" ${d.bust ? "disabled" : ""} />
        <button type="button" class="btn btn-ghost btn-sm flip7-btn ${d.flip7 ? "active" : ""}" ${d.bust ? "disabled" : ""} title="Flip 7" aria-label="Flip 7"><i class="fa-regular fa-star btn-ico" aria-hidden="true"></i><span class="btn-label">Flip 7</span></button>
        <button type="button" class="btn btn-ghost btn-sm bust-btn ${d.bust ? "active" : ""}" title="Éliminé" aria-label="Éliminé"><i class="fa-regular fa-ban btn-ico" aria-hidden="true"></i><span class="btn-label">Éliminé</span></button>
      </div>
    </div>`);
  const numInput = row.querySelector('input[type="number"]');
  const flipBtn = row.querySelector(".flip7-btn");
  const bustBtn = row.querySelector(".bust-btn");
  numInput.addEventListener("input", (e) => {
    draft[p.id].points = e.target.value;
    notify();
  });
  flipBtn.addEventListener("click", () => {
    if (draft[p.id].bust) return;
    draft[p.id].flip7 = !draft[p.id].flip7;
    flipBtn.classList.toggle("active", draft[p.id].flip7);
    row.classList.toggle("flipped", draft[p.id].flip7);
    notify();
  });
  bustBtn.addEventListener("click", () => {
    draft[p.id].bust = !draft[p.id].bust;
    bustBtn.classList.toggle("active", draft[p.id].bust);
    row.classList.toggle("busted", draft[p.id].bust);
    numInput.disabled = draft[p.id].bust;
    flipBtn.disabled = draft[p.id].bust;
    if (draft[p.id].bust) {
      numInput.value = "";
      draft[p.id].flip7 = false;
      flipBtn.classList.remove("active");
      row.classList.remove("flipped");
    }
    notify();
  });
  return row;
}

function buildRoundEntry(game) {
  const section = el(`
    <div class="panel round-entry">
      <h3>Manche ${game.rounds.length + 1}</h3>
      <div class="entry-grid" id="entryGrid"></div>
      <div class="row">
        <button class="btn btn-ghost" id="cancelRound">Annuler</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="saveRound">Enregistrer la manche</button>
      </div>
    </div>`);
  section
    .querySelector("#cancelRound")
    .addEventListener("click", () => go("game", { id: game.id }));

  const grid = section.querySelector("#entryGrid");
  // draft holds entry state per player
  const draft = {};
  game.players.forEach((p) => {
    draft[p.id] = { points: "", flip7: false, bust: false };
    grid.appendChild(buildEntryRow(game, draft, p));
  });

  section.querySelector("#saveRound").addEventListener("click", () => {
    const def = defFor(game);
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = draftToCell(def, draft[p.id]);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ scores, at: Date.now() });
    upsertGame(g);
    toast(`Manche ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });

  return section;
}

// Score entry in a dialog. The in-progress round can be "pre-saved" to
// game.draftRound so closing/reopening keeps the state untouched.
function openScoresDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const saved = game.draftRound || {};
  const draft = {};

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Manche ${game.rounds.length + 1}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body"><div class="entry-grid" id="entryGrid"></div></div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="cancelRound">Annuler</button>
      <button class="btn btn-primary" id="saveRound">Enregistrer la manche</button>
    </div>`;

  // Pre-save the draft live as scores are entered (debounced to avoid writing
  // on every keystroke). Empty drafts clear any saved one.
  const hasData = () => Object.values(draft).some(draftHasData);
  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftRound = hasData() ? JSON.parse(JSON.stringify(draft)) : null;
    upsertGame(g);
  };
  let saveTimer = null;
  const saveDraftSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeDraft, 400);
  };

  const grid = modal.querySelector("#entryGrid");
  game.players.forEach((p) => {
    const s = saved[p.id] || {};
    draft[p.id] = {
      points: s.points != null && s.points !== "" ? String(s.points) : "",
      flip7: !!s.flip7,
      bust: !!s.bust,
    };
    grid.appendChild(buildEntryRow(game, draft, p, saveDraftSoon));
  });

  // Leaving the dialog (×, Annuler, click outside) flushes the pending pre-save
  // so the in-progress round can be resumed later.
  const closeKeepingDraft = () => {
    clearTimeout(saveTimer);
    writeDraft();
    overlay.remove();
    if (currentRoute().name === "game" && currentRoute().id === game.id) go("game", { id: game.id });
  };
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", closeKeepingDraft);
  modal.querySelector("#cancelRound").addEventListener("click", closeKeepingDraft);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  modal.querySelector("#saveRound").addEventListener("click", () => {
    clearTimeout(saveTimer); // cancel any pending draft write
    const def = defFor(game);
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = draftToCell(def, draft[p.id]);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ scores, at: Date.now() });
    g.draftRound = null; // round committed — clear the draft
    upsertGame(g);
    overlay.remove();
    toast(`Manche ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });

  root.appendChild(overlay);
}

/* ---------- Turn-based entry (Qwirkle) ---------- */
// Action bar for a turn-based game: "Qui commence ?" until a starter is set,
// then "Score de <current player>", plus a "Terminer" button once scoring has
// begun.

export { buildRoundEntry, openScoresDialog };
