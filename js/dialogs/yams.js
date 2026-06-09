/* Yam's score-entry dialog: pick a mission, set its value (die count for the
   upper section, fixed for combos, dice sum for Chance) or scratch it; saving
   commits the turn. The same value-entry UI is reused by the turn editor on the
   details screen (openYamsEditDialog) to change an already-played turn. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import {
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsCat,
  yamsBadge,
  yamsCategories,
  yamsFilled,
  yamsUpperSum,
} from "../rules.js";
import { currentPlayer, winner } from "../scoring.js";
import { go, currentRoute } from "../nav.js";
import { celebrateIfNewWinner } from "./celebrate.js";

// Inner HTML for the value-entry row of the selected mission, shared by the
// score-entry and turn-edit dialogs. Upper section takes a die count (× face),
// fixed combos show their value, Chance takes the dice sum entered as-is.
function yamsValueHTML(c, scratched, rawValue) {
  const scratchBtnHtml = `<button type="button" class="btn btn-ghost btn-sm yams-scratch${scratched ? " active" : ""}" id="scratchBtn" title="Barrer (0)" aria-label="Barrer (0)"><i class="fa-regular fa-ban" aria-hidden="true"></i></button>`;
  if (c.free) {
    const hint = "Somme des 5 dés (5 à 30)";
    return `
      <div class="yams-value-row">
        <div class="yams-value-main">
          <span class="yams-value-label">${esc(c.label)}</span>
          <span class="yams-hint muted">${hint}</span>
        </div>
        <input type="number" class="cell-input" id="yamsInput" placeholder="0" inputmode="numeric" min="0" max="30" aria-label="${hint}" value="${esc(scratched ? "" : rawValue)}" ${scratched ? "disabled" : ""} />
        <span class="yams-value-fixed">pts</span>
        ${scratchBtnHtml}
      </div>`;
  }
  if (c.fixed != null) {
    return `
      <div class="yams-value-row">
        <div class="yams-value-main">
          <span class="yams-value-label">${esc(c.label)}</span>
        </div>
        <span class="yams-value-fixed${scratched ? " struck" : ""}">${scratched ? "0" : c.fixed} pts</span>
        ${scratchBtnHtml}
      </div>`;
  }
  const face = c.face || 1;
  const computed = (Number(rawValue) || 0) * face;
  const hint = `Nombre de ${esc(c.label.toLowerCase())} (× ${face})`;
  return `
    <div class="yams-value-row">
      <div class="yams-value-main">
        <span class="yams-value-label">${esc(c.label)}</span>
        <span class="yams-hint muted">${hint}</span>
      </div>
      <input type="number" class="cell-input" id="yamsInput" placeholder="0" inputmode="numeric" min="0" max="5" aria-label="${hint}" value="${esc(scratched ? "" : rawValue)}" ${scratched ? "disabled" : ""} />
      <span class="yams-value-fixed" id="yamsComputed">= ${computed} pts</span>
      ${scratchBtnHtml}
    </div>`;
}

// Effective points for a mission given its raw entry: 0 if scratched, the dice
// sum for Chance, the fixed value for combos, else die count × face.
function yamsEffPoints(c, scratched, rawValue) {
  if (!c || scratched) return 0;
  if (c.free) return Number(rawValue) || 0;
  if (c.fixed != null) return c.fixed;
  return (Number(rawValue) || 0) * (c.face || 1);
}

// Rebuild the raw entry string from a stored cell, for pre-filling the editor.
// Upper cells store points = count × face (so divide back); Chance stores the
// sum directly; fixed combos need no raw value.
function yamsRawFromPoints(c, points) {
  if (!c || c.fixed != null) return "";
  if (c.free) return points ? String(points) : "";
  return points ? String(points / (c.face || 1)) : "";
}

export function openYamsDialog(game) {
  const cur = currentPlayer(game);
  if (!cur) return;
  const turnNo = game.rounds.length + 1;
  const filled = yamsFilled(game, cur.id);
  // Points already marked by this player per mission (to show on filled cases).
  const marked = {};
  game.rounds.forEach((r) => {
    const c = r.scores[cur.id];
    if (c && c.category) marked[c.category] = Number(c.points) || 0;
  });
  const upperSum = yamsUpperSum(game, cur.id);
  const saved =
    game.draftTurn && game.draftTurn.category ? game.draftTurn : null;
  let selKey =
    saved && !filled.has(saved.category) ? saved.category : null;
  let scratched = saved ? !!saved.scratched : false;
  let rawValue = saved && saved.value != null ? String(saved.value) : "";

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const bonusNote =
    upperSum >= YAMS_BONUS_MIN
      ? ` ✓ +${YAMS_BONUS}`
      : ` (encore ${YAMS_BONUS_MIN - upperSum})`;
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de ${esc(cur.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">Tour ${turnNo} · Section haute ${upperSum} / ${YAMS_BONUS_MIN}${bonusNote}</div>
      <div class="yams-missions" id="yamsMissions"></div>
      <div class="yams-value" id="yamsValue" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveYams">Enregistrer</button>
    </div>`;

  const missionsEl = modal.querySelector("#yamsMissions");
  const valueEl = modal.querySelector("#yamsValue");

  // All missions stay visible; already-played ones are disabled and show the
  // score that was marked (fixed value, computed upper score, or 0 if scratched).
  yamsCategories(game).forEach((c) => {
    const done = filled.has(c.key);
    const tag = done
      ? `<span class="yams-fixed">${marked[c.key]}</span>`
      : `<span class="yams-fixed">${yamsBadge(c)}</span>`;
    const btn = el(
      `<button type="button" class="yams-mission yams-${c.section}${done ? " filled" : ""}" data-key="${c.key}"${done ? " disabled" : ""}><span class="yams-mission-name">${esc(c.label)}</span>${tag}</button>`,
    );
    if (!done)
      btn.addEventListener("click", () => {
        selKey = c.key;
        scratched = false;
        rawValue = "";
        syncSel();
        drawValue();
        writeDraft();
      });
    missionsEl.appendChild(btn);
  });

  const syncSel = () =>
    missionsEl
      .querySelectorAll(".yams-mission")
      .forEach((b) => b.classList.toggle("active", b.dataset.key === selKey));

  function drawValue() {
    if (!selKey) {
      valueEl.hidden = true;
      valueEl.innerHTML = "";
      return;
    }
    const c = yamsCat(selKey);
    valueEl.hidden = false;
    valueEl.innerHTML = yamsValueHTML(c, scratched, rawValue);
    valueEl.querySelector("#scratchBtn").addEventListener("click", () => {
      scratched = !scratched;
      drawValue();
      writeDraft();
    });
    const input = valueEl.querySelector("#yamsInput");
    if (input) {
      input.addEventListener("input", () => {
        rawValue = input.value;
        const comp = valueEl.querySelector("#yamsComputed");
        if (comp) {
          const cc = yamsCat(selKey);
          comp.textContent = `= ${(Number(rawValue) || 0) * (cc.face || 1)} pts`;
        }
        writeDraft();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      if (!scratched) input.focus();
    }
  }

  const effPoints = () => yamsEffPoints(yamsCat(selKey), scratched, rawValue);

  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftTurn = selKey
      ? { category: selKey, scratched, value: rawValue, points: effPoints() }
      : null;
    upsertGame(g);
  };

  const closeKeepingDraft = () => {
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
    if (!selKey) return toast("Choisissez une mission");
    const points = effPoints();
    const g = getGame(game.id);
    const before = (winner(g) || {}).id || null; // winner before this mission
    g.rounds.push({
      scores: { [cur.id]: { category: selKey, points } },
      at: Date.now(),
    });
    g.draftTurn = null; // turn committed — clear the draft
    upsertGame(g);
    overlay.remove();
    const cat = yamsCat(selKey);
    toast(`${cur.name} — ${cat.label} : ${points} pts`);
    go("game", { id: game.id });
    // The last filled cell can complete the card → celebrate the new winner.
    celebrateIfNewWinner(before, g);
  };
  modal.querySelector("#saveYams").addEventListener("click", save);

  syncSel();
  drawValue();
  root.appendChild(overlay);
}

/* Turn editor (details screen): change an already-played turn — its mission
   choice and/or value — for a given player. `refresh` re-renders the caller
   (the details screen) after a save. Unlike the entry dialog, this never
   touches the in-progress draft and rewrites an existing round in place. */
export function openYamsEditDialog(game, pid, origCategory, refresh) {
  const player = game.players.find((p) => p.id === pid);
  if (!player) return;
  // Points marked by this player per mission (shown on the locked cells).
  const marked = {};
  game.rounds.forEach((r) => {
    const c = r.scores[pid];
    if (c && c.category) marked[c.category] = Number(c.points) || 0;
  });
  // Every mission this player already played EXCEPT the one being edited stays
  // locked, so the turn can be moved to a free mission but never onto a dup.
  const filled = new Set(
    [...yamsFilled(game, pid)].filter((k) => k !== origCategory),
  );
  const upperSum = yamsUpperSum(game, pid);

  let selKey = origCategory;
  const origCell = yamsCat(origCategory);
  let scratched = (marked[origCategory] || 0) === 0;
  let rawValue = yamsRawFromPoints(origCell, marked[origCategory] || 0);

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const bonusNote =
    upperSum >= YAMS_BONUS_MIN
      ? ` ✓ +${YAMS_BONUS}`
      : ` (encore ${YAMS_BONUS_MIN - upperSum})`;
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Modifier le tour de ${esc(player.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">Section haute ${upperSum} / ${YAMS_BONUS_MIN}${bonusNote}</div>
      <div class="yams-missions" id="yamsMissions"></div>
      <div class="yams-value" id="yamsValue" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveYams">Enregistrer</button>
    </div>`;

  const missionsEl = modal.querySelector("#yamsMissions");
  const valueEl = modal.querySelector("#yamsValue");

  yamsCategories(game).forEach((c) => {
    const locked = filled.has(c.key);
    const tag = locked
      ? `<span class="yams-fixed">${marked[c.key]}</span>`
      : `<span class="yams-fixed">${yamsBadge(c)}</span>`;
    const btn = el(
      `<button type="button" class="yams-mission yams-${c.section}${locked ? " filled" : ""}" data-key="${c.key}"${locked ? " disabled" : ""}><span class="yams-mission-name">${esc(c.label)}</span>${tag}</button>`,
    );
    if (!locked)
      btn.addEventListener("click", () => {
        selKey = c.key;
        scratched = false;
        rawValue = "";
        syncSel();
        drawValue();
      });
    missionsEl.appendChild(btn);
  });

  const syncSel = () =>
    missionsEl
      .querySelectorAll(".yams-mission")
      .forEach((b) => b.classList.toggle("active", b.dataset.key === selKey));

  function drawValue() {
    const c = yamsCat(selKey);
    valueEl.hidden = false;
    valueEl.innerHTML = yamsValueHTML(c, scratched, rawValue);
    valueEl.querySelector("#scratchBtn").addEventListener("click", () => {
      scratched = !scratched;
      drawValue();
    });
    const input = valueEl.querySelector("#yamsInput");
    if (input) {
      input.addEventListener("input", () => {
        rawValue = input.value;
        const comp = valueEl.querySelector("#yamsComputed");
        if (comp) {
          const cc = yamsCat(selKey);
          comp.textContent = `= ${(Number(rawValue) || 0) * (cc.face || 1)} pts`;
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      if (!scratched) input.focus();
    }
  }

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const save = () => {
    if (!selKey) return toast("Choisissez une mission");
    const points = yamsEffPoints(yamsCat(selKey), scratched, rawValue);
    const g = getGame(game.id);
    const before = (winner(g) || {}).id || null; // winner before this edit
    const r = g.rounds.find((rr) => {
      const cc = rr.scores[pid];
      return cc && cc.category === origCategory;
    });
    if (!r) {
      overlay.remove();
      return refresh();
    }
    r.scores[pid] = { category: selKey, points };
    upsertGame(g);
    overlay.remove();
    const cat = yamsCat(selKey);
    toast(`${player.name} — ${cat.label} : ${points} pts`);
    refresh();
    // An edit can crown a new leader (or undo a win) → celebrate if it does.
    celebrateIfNewWinner(before, g);
  };
  modal.querySelector("#saveYams").addEventListener("click", save);

  syncSel();
  drawValue();
  root.appendChild(overlay);
}

/* ---------- Contrée (teams + bids) ---------- */
// Compact team scoreboard: the two teams ranked by total, leader crowned.
