/* Yam's score-entry dialog: pick a mission, set its value (die count for the
   upper section, fixed for combos) or scratch it; saving commits the turn. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import {
  YAMS_CATEGORIES,
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsCat,
  yamsFilled,
  yamsUpperSum,
} from "../rules.js";
import { currentPlayer } from "../scoring.js";
import { go } from "../nav.js";

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
  YAMS_CATEGORIES.forEach((c) => {
    const done = filled.has(c.key);
    const tag = done
      ? `<span class="yams-fixed">${marked[c.key]}</span>`
      : c.fixed != null
        ? `<span class="yams-fixed">${c.fixed}</span>`
        : "";
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
    const scratchBtnHtml = `<button type="button" class="btn btn-ghost btn-sm yams-scratch${scratched ? " active" : ""}" id="scratchBtn"><i class="fa-regular fa-ban"></i> Barrer (0)</button>`;
    if (c.fixed != null) {
      valueEl.innerHTML = `
        <div class="yams-value-row">
          <span class="yams-value-label">${esc(c.label)}</span>
          <span class="yams-value-fixed${scratched ? " struck" : ""}">${scratched ? "0" : c.fixed} pts</span>
          ${scratchBtnHtml}
        </div>`;
    } else {
      const face = c.face || 1;
      const computed = (Number(rawValue) || 0) * face;
      const hint = `Nombre de ${esc(c.label.toLowerCase())} (× ${face})`;
      valueEl.innerHTML = `
        <div class="yams-value-row">
          <span class="yams-value-label">${esc(c.label)}</span>
          <input type="number" class="cell-input" id="yamsInput" placeholder="0" inputmode="numeric" min="0" max="5" aria-label="${hint}" value="${esc(scratched ? "" : rawValue)}" ${scratched ? "disabled" : ""} />
          <span class="yams-value-fixed" id="yamsComputed">= ${computed} pts</span>
          ${scratchBtnHtml}
        </div>
        <div class="yams-hint muted">${hint}</div>`;
    }
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

  // Effective numeric points for the current selection. Upper-section missions
  // take a die count and score count × face; lower missions are fixed values.
  const effPoints = () => {
    if (!selKey || scratched) return 0;
    const c = yamsCat(selKey);
    if (c.fixed != null) return c.fixed;
    return (Number(rawValue) || 0) * (c.face || 1);
  };

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
  };
  modal.querySelector("#saveYams").addEventListener("click", save);

  syncSel();
  drawValue();
  root.appendChild(overlay);
}

/* ---------- Contrée (teams + bids) ---------- */
// Compact team scoreboard: the two teams ranked by total, leader crowned.
