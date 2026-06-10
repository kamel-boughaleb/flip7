/* Score-entry dialogs for round-based games: per-player entry rows, the
   multi-player "Nouveaux scores" dialog, and the screen-2 round editor. */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { defFor, brutalEnabled } from "../rules.js";
import { winner } from "../scoring.js";
import { celebrateIfNewWinner } from "./celebrate.js";
import { go, currentRoute } from "../nav.js";

function draftHasData(d) {
  return d && ((d.points !== "" && d.points != null) || d.flip7 || d.bust);
}
// Convert a draft cell to a stored round cell, per the game's entry style.
function draftToCell(def, d, game) {
  if (def.entry === "number") {
    const cell = { points: Number(d.points) || 0 };
    if (def.doubling && d.doubled) cell.doubled = true; // ×2 round penalty
    return cell;
  }
  // Brutal (Vengeance): keep the entered total even when eliminated (negatives
  // allowed) and carry the Flip 7 redirect target.
  if (brutalEnabled(game)) {
    const raw = Number(d.points) || 0;
    const cell = {
      // An eliminated player's total is a malus → forced negative.
      points: d.bust ? -Math.abs(raw) : raw,
      flip7: !d.bust && !!d.flip7,
      bust: !!d.bust,
    };
    if (cell.flip7 && d.flip7To) cell.flip7To = d.flip7To; // −15 → opponent
    return cell;
  }
  return {
    points: d.bust ? 0 : Number(d.points) || 0,
    flip7: d.bust ? false : !!d.flip7,
    bust: !!d.bust,
  };
}
// Recompute the top-right +15/−15 badge each Brutal Flip 7 row RECEIVES this
// round: +15 when the player kept their own Flip 7, −15 for every opponent who
// redirected theirs here. It's a cross-player effect, so it's a single pass
// over all rows rather than per-row state.
function refreshFlip7Badges(grid, game, draft) {
  grid.querySelectorAll(".entry-player[data-pid]").forEach((rowEl) => {
    const badge = rowEl.querySelector(".flip7-effect-badge");
    if (!badge) return;
    const xid = rowEl.dataset.pid;
    let delta = 0;
    const own = draft[xid];
    if (own && own.flip7 && !own.flip7To) delta += 15; // kept for self
    game.players.forEach((y) => {
      const dy = draft[y.id];
      if (dy && dy.flip7 && dy.flip7To === xid) delta -= 15; // redirected here
    });
    badge.hidden = delta === 0;
    badge.textContent =
      delta === 0 ? "" : (delta > 0 ? "+" : "−") + Math.abs(delta);
    badge.classList.toggle("is-plus", delta > 0);
    badge.classList.toggle("is-minus", delta < 0);
  });
}

// Build and wire one player's score-entry row. `draft[p.id]` must be set.
// Renders the Flip 7 controls (number + bonus + Éliminé) or, for "number"
// games like Skyjo, a single number input (negatives allowed). `onChange` (if
// given) fires after every draft mutation, e.g. to pre-save the round live.
// `refreshBadges` (Brutal Flip 7) re-renders the cross-player +15/−15 badges.
function buildEntryRow(game, draft, p, onChange, refreshBadges) {
  const def = defFor(game);
  const d = draft[p.id];
  const notify = () => onChange && onChange();
  if (def.entry === "number") {
    // Team games (Time's Up!): list the team's players under its name.
    const nameCell =
      p.members && p.members.length
        ? `<div class="pname"><span>${esc(p.name)}</span><div class="name-sub muted">${p.members.map((m) => esc(m.name)).join(", ")}</div></div>`
        : `<span class="pname">${esc(p.name)}</span>`;
    const row = el(`
      <div class="entry-player${d.doubled ? " doubled" : ""}">
        ${nameCell}
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
  // Flip 7 entry: number + "Flip 7" bonus + "Éliminé". Mode Brutal (Vengeance)
  // adds a ± sign (negative totals), keeps an eliminated player's score, and
  // opens a dialog to send the Flip 7 as +15 to self or −15 to an opponent.
  // Each Brutal row carries a top-right badge for the +15/−15 it receives this
  // round; the cross-player recompute is delegated to refreshBadges().
  const brutal = brutalEnabled(game);
  const bump = () => refreshBadges && refreshBadges();
  const row = el(`
    <div class="entry-player ${d.bust ? "busted" : d.flip7 ? "flipped" : ""}"${brutal ? ` data-pid="${p.id}"` : ""}>
      ${brutal ? '<span class="flip7-effect-badge" hidden></span>' : ""}
      <span class="pname">${esc(p.name)}</span>
      <div class="entry-controls">
        ${brutal ? `<button type="button" class="btn btn-ghost btn-sm sign-btn" title="Score négatif" aria-label="Inverser le signe"${d.bust ? " disabled" : ""}>±</button>` : ""}
        <input type="number" inputmode="numeric" class="cell-input" placeholder="0" ${brutal ? "" : 'min="0"'} value="${!brutal && d.bust ? "" : esc(d.points)}" ${!brutal && d.bust ? "disabled" : ""} />
        <button type="button" class="btn btn-ghost btn-sm flip7-btn ${d.flip7 ? "active" : ""}" ${d.bust ? "disabled" : ""} title="Flip 7" aria-label="Flip 7"><i class="fa-regular fa-star btn-ico" aria-hidden="true"></i><span class="btn-label">Flip 7</span></button>
        <button type="button" class="btn btn-ghost btn-sm bust-btn ${d.bust ? "active" : ""}" title="Éliminé" aria-label="Éliminé"><i class="fa-regular fa-ban btn-ico" aria-hidden="true"></i><span class="btn-label">Éliminé</span></button>
      </div>
    </div>`);
  const numInput = row.querySelector('input[type="number"]');
  const flipBtn = row.querySelector(".flip7-btn");
  const bustBtn = row.querySelector(".bust-btn");
  const signBtn = row.querySelector(".sign-btn");
  // Apply a Flip 7 choice to the draft + row UI. `to`: "" = self, an id = that
  // opponent takes −15, null = remove the Flip 7.
  const setFlip7 = (to) => {
    const on = to !== null;
    draft[p.id].flip7 = on;
    draft[p.id].flip7To = on ? to || null : null;
    flipBtn.classList.toggle("active", on);
    row.classList.toggle("flipped", on);
    notify();
    bump();
  };
  // Eliminated players only take a malus: force a non-positive value (the sign
  // is imposed, so the ± toggle is hidden while eliminated).
  const clampBustNeg = () => {
    if (!(brutal && draft[p.id].bust)) return;
    const n = Number(numInput.value);
    if (n > 0) numInput.value = String(-n);
  };
  numInput.addEventListener("input", () => {
    clampBustNeg();
    draft[p.id].points = numInput.value;
    notify();
  });
  if (signBtn)
    signBtn.addEventListener("click", () => {
      const v = String(numInput.value).trim();
      numInput.value = v.startsWith("-") ? v.slice(1) : v ? "-" + v : v;
      draft[p.id].points = numInput.value;
      numInput.focus();
      notify();
    });
  flipBtn.addEventListener("click", () => {
    if (draft[p.id].bust) return;
    if (!brutal) {
      setFlip7(draft[p.id].flip7 ? null : ""); // plain toggle (always self)
      return;
    }
    // Brutal: pick the +15 (self) / −15 (opponent) destination in a dialog.
    openFlip7TargetDialog(game, p, draft[p.id], (choice) => setFlip7(choice));
  });
  bustBtn.addEventListener("click", () => {
    draft[p.id].bust = !draft[p.id].bust;
    bustBtn.classList.toggle("active", draft[p.id].bust);
    row.classList.toggle("busted", draft[p.id].bust);
    if (draft[p.id].bust) {
      // Eliminated clears the Flip 7 bonus. Outside Brutal it also zeroes the
      // score (input disabled); in Brutal the entered total becomes a negative
      // malus, so we clamp it and hide the ± toggle (sign is imposed).
      draft[p.id].flip7 = false;
      draft[p.id].flip7To = null;
      flipBtn.classList.remove("active");
      row.classList.remove("flipped");
      if (brutal) {
        clampBustNeg();
        draft[p.id].points = numInput.value;
        if (signBtn) signBtn.disabled = true; // sign is imposed (negative)
      } else {
        numInput.value = "";
        draft[p.id].points = "";
      }
    } else if (signBtn) {
      signBtn.disabled = false; // free sign again once no longer eliminated
    }
    numInput.disabled = !brutal && draft[p.id].bust;
    flipBtn.disabled = draft[p.id].bust;
    notify();
    bump();
  });
  return row;
}

// Brutal (Vengeance) Flip 7 destination picker, styled like the Yam's mission
// list. Lists "+15 pour <author>" first, then "−15 pour <each opponent>".
// Calls onPick("" = self, an opponent id, or null = remove the Flip 7);
// cancelling (×, Annuler, click outside) calls nothing.
function openFlip7TargetDialog(game, author, current, onPick) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const selfActive = !!current.flip7 && !current.flip7To;
  const items =
    `<button type="button" class="yams-mission${selfActive ? " active" : ""}" data-to=""><span class="yams-mission-name">+15 pour ${esc(author.name)}</span><span class="yams-fixed f7-plus">+15</span></button>` +
    game.players
      .filter((o) => o.id !== author.id)
      .map(
        (o) =>
          `<button type="button" class="yams-mission${current.flip7 && current.flip7To === o.id ? " active" : ""}" data-to="${o.id}"><span class="yams-mission-name">−15 pour ${esc(o.name || "?")}</span><span class="yams-fixed f7-minus">−15</span></button>`,
      )
      .join("");

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Flip 7 de ${esc(author.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <p class="turn-meta">Où envoyer le bonus du Flip 7 ?</p>
      <div class="yams-missions" id="f7targets">${items}</div>
    </div>
    <div class="scores-dialog-foot">
      ${current.flip7 ? '<button class="btn btn-ghost" data-act="remove">Retirer le Flip 7</button>' : ""}
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
    </div>`;

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  const removeBtn = modal.querySelector("[data-act=remove]");
  if (removeBtn)
    removeBtn.addEventListener("click", () => {
      close();
      onPick(null);
    });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelectorAll("#f7targets .yams-mission").forEach((b) =>
    b.addEventListener("click", () => {
      close();
      onPick(b.dataset.to); // "" = self, otherwise the opponent id
    }),
  );
  root.appendChild(overlay);
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
  const refreshBadges = () => refreshFlip7Badges(grid, game, draft);
  game.players.forEach((p) => {
    draft[p.id] = { points: "", flip7: false, flip7To: null, bust: false };
    grid.appendChild(buildEntryRow(game, draft, p, null, refreshBadges));
  });
  refreshBadges();

  section.querySelector("#saveRound").addEventListener("click", () => {
    const def = defFor(game);
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = draftToCell(def, draft[p.id], game);
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
  const refreshBadges = () => refreshFlip7Badges(grid, game, draft);
  game.players.forEach((p) => {
    const s = saved[p.id] || {};
    draft[p.id] = {
      points: s.points != null && s.points !== "" ? String(s.points) : "",
      flip7: !!s.flip7,
      flip7To: s.flip7To || null,
      bust: !!s.bust,
    };
    grid.appendChild(buildEntryRow(game, draft, p, saveDraftSoon, refreshBadges));
  });
  refreshBadges();

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
      scores[p.id] = draftToCell(def, draft[p.id], game);
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

export { buildRoundEntry, openScoresDialog, draftToCell };
