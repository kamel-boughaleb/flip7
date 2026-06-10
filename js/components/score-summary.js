/* <app-score-summary> — the compact game scoreboard (rank · name · total).
   Data in via `.game`; it derives standings/winner itself. Shows the live
   projected total (and projected crown) while a round/turn is in progress.
   Rendered as a div list (not a table): on Flip 7, a row can be swiped left to
   toggle that player's elimination for the in-progress round, without opening
   the score-entry dialog. */
import { esc, toast } from "../util.js";
import { defFor, brutalEnabled } from "../rules.js";
import { getGame, upsertGame } from "../store.js";
import { draftToCell } from "../dialogs/scores.js";
import {
  standings,
  winner,
  winners,
  winnersFromStandings,
  currentPlayer,
  rankLabels,
  turnDraftHasData,
} from "../scoring.js";

class AppScoreSummary extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  render() {
    const game = this._g;
    if (!game) return;
    const st = standings(game);
    const w = winner(game);
    const hasRounds = game.rounds.length > 0;
    const winIds = new Set(winners(game).map((p) => p.id));
    const labels = rankLabels(st, (a, b) => a.total === b.total);
    const def = defFor(game);
    // Once the game is over OR cancelled, ignore any leftover in-progress draft:
    // the scoreboard must show the final standings, not a stale round preview.
    const draft = (w ? null : game.draftRound) || {};
    // Swipe-to-eliminate only makes sense for Flip 7 (the "bust" notion) and
    // only while the game is still running.
    const canSwipe = def.entry === "flip7" && !w && !game.cancelled;
    // Turn-based games pre-save a single player's turn (the current player).
    const turnCur = def.turnBased ? currentPlayer(game) : null;
    const turnDraft =
      !w && turnCur && turnDraftHasData(game.draftTurn) ? game.draftTurn : null;
    const draftCellFor = (p) => {
      if (def.turnBased)
        return turnDraft && p.id === turnCur.id
          ? {
              points: turnDraft.drawn ? 0 : Number(turnDraft.points) || 0,
              drawn: !!turnDraft.drawn,
            }
          : null;
      const dc = draft[p.id];
      return dc && ((dc.points !== "" && dc.points != null) || dc.flip7 || dc.bust)
        ? dc
        : null;
    };
    const hasDraftFor = (p) => !!draftCellFor(p);
    const brutal = brutalEnabled(game);
    const projected = {};
    st.forEach((p) => {
      const dc = draftCellFor(p);
      let val = dc ? def.cellValue(dc, game) : 0;
      // Brutal: a Flip 7 redirected to p in the in-progress round projects −15
      // (a cross-player malus cellValue can't see; mirrors the ruleset extraTotal).
      if (brutal)
        for (const k in draft) {
          const c = draft[k];
          if (c && c.flip7 && c.flip7To === p.id) val -= def.bonus;
        }
      projected[p.id] = p.total + val;
    });
    // Projected winner(s): only while the game isn't won and a round is pending.
    const projWinnerIds = new Set();
    if (!w && st.some(hasDraftFor)) {
      const projStandings = st
        .map((p) => ({ id: p.id, total: projected[p.id] }))
        .sort((a, b) =>
          def.scoreOrder === "asc" ? a.total - b.total : b.total - a.total,
        );
      winnersFromStandings(game, projStandings).forEach((p) =>
        projWinnerIds.add(p.id),
      );
    }
    const rows = st
      .map((p, i) => {
        const { place, label } = labels[i];
        const won = winIds.has(p.id);
        const crown = won
          ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
          : "";
        const rankClass = `rank${place}`;
        const rankBadge = hasRounds
          ? `<span class="badge ${rankClass}">${label}</span>`
          : "";
        const previewCrown = projWinnerIds.has(p.id)
          ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>'
          : "";
        const eliminated = !!(draft[p.id] && draft[p.id].bust);
        const drew = !!(
          turnDraft &&
          turnCur &&
          p.id === turnCur.id &&
          turnDraft.drawn
        );
        // Pastille de preview : prochain total puis, entre (), la variation
        // signée de la manche en cours (projeté − total actuel). Le `gain != 0`
        // capte aussi un joueur SANS saisie propre qui subit un effet — p. ex.
        // le −15 d'un Flip 7 Brutal redirigé vers lui.
        const gain = projected[p.id] - p.total;
        const signed = gain > 0 ? `+${gain}` : `${gain}`;
        // A lower projected total than the current one is a loss → red pill.
        const pastille = `<span class="score-preview${gain < 0 ? " is-loss" : ""}">${projected[p.id]} <span class="score-preview-delta">(${signed})</span>${previewCrown}</span>`;
        let preview = "";
        if (drew) preview = '<span class="elim-tag">Pioche</span>';
        else if (eliminated)
          preview = gain !== 0 ? pastille : ""; // only a real (Brutal) malus shows
        else if (hasDraftFor(p) || gain !== 0) preview = pastille;
        // Team games (Time's Up!): list the team's players under its name.
        const sub =
          p.members && p.members.length
            ? `<div class="name-sub muted">${p.members.map((m) => esc(m.name)).join(", ")}</div>`
            : "";
        // Swipe action revealed behind the row: eliminate (red), or restore
        // (green) on an already-eliminated player — the same gesture toggles.
        const action = canSwipe
          ? `<div class="summary-row-action ${eliminated ? "is-restore" : "is-eliminate"}" aria-hidden="true"><i class="fa-regular fa-${eliminated ? "rotate-left" : "ban"}"></i></div>`
          : "";
        return `<div class="summary-row${won ? " winner-row" : ""}${eliminated || drew ? " eliminated-row" : ""}"${canSwipe ? ` data-pid="${p.id}"` : ""}>
          ${action}
          <div class="summary-row-fg">
            <span class="rank-col">${rankBadge}</span>
            <span class="player-name">${esc(p.name)}${sub}</span>
            <span class="total-cell"><span class="score-badge ${rankClass}">${p.total}${crown}</span>${preview}</span>
          </div>
        </div>`;
      })
      .join("");
    this.innerHTML = `<div class="table-wrap summary-list">${rows}</div>`;
    if (canSwipe)
      this.querySelectorAll(".summary-row[data-pid]").forEach((r) =>
        this._attachSwipe(r),
      );
  }

  // Pointer-driven left swipe on a row: drag the foreground left, and past a
  // threshold on release toggle the player's elimination. `touch-action: pan-y`
  // (CSS) keeps vertical scrolling working; we only claim horizontal moves.
  _attachSwipe(rowEl) {
    const fg = rowEl.querySelector(".summary-row-fg");
    const pid = rowEl.dataset.pid;
    const THRESHOLD = 64;
    let startX = 0,
      startY = 0,
      dx = 0;
    let dragging = false,
      decided = false,
      horizontal = false;
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dragging = true;
      decided = false;
      horizontal = false;
      fg.style.transition = "none";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (!decided) {
        // Wait until the gesture has a clear direction before claiming it.
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        horizontal = Math.abs(mx) > Math.abs(my);
        if (horizontal) {
          try {
            fg.setPointerCapture(e.pointerId);
          } catch {}
        }
      }
      if (!horizontal) return; // vertical intent → let the page scroll
      dx = Math.max(-110, Math.min(0, mx)); // left only, clamped
      fg.style.transform = `translateX(${dx}px)`;
      rowEl.classList.toggle("will-trigger", dx <= -THRESHOLD);
      e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const trigger = horizontal && dx <= -THRESHOLD;
      fg.style.transition = "transform 0.2s ease";
      fg.style.transform = "";
      rowEl.classList.remove("will-trigger");
      if (trigger) this._toggleEliminate(pid);
    };
    fg.addEventListener("pointerdown", onDown);
    fg.addEventListener("pointermove", onMove);
    fg.addEventListener("pointerup", onUp);
    fg.addEventListener("pointercancel", onUp);
  }

  // Toggle `bust` for a player in the in-progress round draft, then ask the
  // host (game screen) to re-render via a bubbling "draftchanged" event.
  _toggleEliminate(pid) {
    const g = getGame(this._g.id);
    if (!g) return;
    const draft = g.draftRound ? { ...g.draftRound } : {};
    const cur = {
      points: "",
      flip7: false,
      flip7To: null,
      bust: false,
      ...(draft[pid] || {}),
    };
    cur.bust = !cur.bust;
    if (cur.bust) {
      cur.flip7 = false;
      cur.flip7To = null;
    }
    draft[pid] = cur;
    // If EVERY player is now eliminated the round is fully decided (no scores
    // left to validate): commit it straight away and move on to the next round.
    // A 0/negative round can never reach the target, so no win to celebrate.
    const allBust = g.players.every((p) => draft[p.id] && draft[p.id].bust);
    if (allBust) {
      const def = defFor(g);
      const scores = {};
      g.players.forEach((p) => {
        scores[p.id] = draftToCell(def, draft[p.id], g);
      });
      g.rounds.push({ scores, at: Date.now() });
      g.draftRound = null;
      upsertGame(g);
      toast(`Manche ${g.rounds.length} enregistrée`);
    } else {
      // Drop cells that no longer carry any data; clear the draft if all gone.
      const hasData = (d) =>
        (d.points !== "" && d.points != null) || d.flip7 || d.bust;
      Object.keys(draft).forEach((k) => {
        if (!hasData(draft[k])) delete draft[k];
      });
      g.draftRound = Object.keys(draft).length ? draft : null;
      upsertGame(g);
    }
    this.dispatchEvent(new CustomEvent("draftchanged", { bubbles: true }));
  }
}

customElements.define("app-score-summary", AppScoreSummary);
