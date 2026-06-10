/* <app-score-table> — per-round details for round-based games (Flip 7, Skyjo,
   Time's Up!). One column per round; cells stay editable (Flip 7 "+15" bonus,
   Skyjo "×2" doubling, or a plain number) and whole rounds can be removed.
   Data in via `.game`; mutations write to the store and emit a bubbling
   "changed" event (carrying the prior winner id on score edits) so the details
   screen refreshes and celebrates a new win. */
import { el, esc } from "../util.js";
import { defFor, unitLabel, brutalEnabled } from "../rules.js";
import { standings, winner, winners, rankLabels } from "../scoring.js";
import { getGame, upsertGame } from "../store.js";
import { confirmDialog } from "../ui.js";

// "10+15" → { points: 10, flip7: true } ; "10" → { points: 10, flip7: false }.
function parseFlip7Input(value) {
  const v = String(value).trim().replace(/\s+/g, "");
  const m = v.match(/^(-?\d*)\+15$/);
  if (m) return { points: Number(m[1]) || 0, flip7: true };
  return { points: Number(v) || 0, flip7: false };
}
// "15x2" / "-3×2" → { points, doubled: true } ; "15" → { points, doubled: false }.
function parseSkyjoInput(value) {
  const v = String(value).trim().replace(/\s+/g, "");
  const m = v.match(/^(-?\d*)[x×*]2$/i);
  if (m) return { points: Number(m[1]) || 0, doubled: true };
  return { points: Number(v) || 0, doubled: false };
}

class AppScoreTable extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  changed(before) {
    const detail = before === undefined ? {} : { before };
    this.dispatchEvent(new CustomEvent("changed", { detail, bubbles: true }));
  }

  render() {
    const game = this._g;
    if (!game) return;
    const def = defFor(game);
    const isFlip7Game = def.entry === "flip7";
    const brutal = brutalEnabled(game); // Vengeance: negatives + scorable eliminated + Flip 7 redirect
    const hasRounds = game.rounds.length > 0;
    const winIds = new Set(winners(game).map((p) => p.id));
    const st = standings(game);
    const labels = rankLabels(st, (a, b) => a.total === b.total);

    const wrap = el(`<div class="table-wrap"></div>`);
    const table = el(`<table class="score"></table>`);
    let thead = `<thead><tr><th class="rank-col">#</th><th class="player-name">${unitLabel(game.mode)}</th>`;
    game.rounds.forEach((_, i) => {
      thead += `<th>M${i + 1}</th>`;
    });
    thead += `<th>Total</th></tr></thead>`;
    table.innerHTML = thead;

    const tbody = el(`<tbody></tbody>`);
    st.forEach((sp, idx) => {
      const p = sp;
      const total = sp.total;
      const place = labels[idx].place;
      const label = labels[idx].label;
      const won = winIds.has(p.id);
      const rankBadge = hasRounds
        ? `<span class="badge rank${place}">${label}</span>`
        : "";
      const tr = el(
        `<tr class="${won ? "winner-row" : ""}"><td class="rank-col">${rankBadge}</td><td class="player-name">${esc(p.name)}</td></tr>`,
      );

      game.rounds.forEach((r, ri) => {
        const cell = r.scores[p.id] || { points: 0, flip7: false, bust: false };
        const td = el(`<td></td>`);
        // Eliminated: 0 outside Brutal; in Brutal the kept total is a negative
        // malus (an eliminated player can never gain points).
        const pts = cell.bust
          ? brutal
            ? -Math.abs(Number(cell.points) || 0)
            : 0
          : Number(cell.points) || 0;
        if (isFlip7Game) {
          // The +15 badge reflects only a bonus kept by its author: a Brutal
          // Flip 7 redirected to an opponent (flip7To) keeps flip7 but no badge.
          const ownFlip7 =
            (brutal || !cell.bust) && !!cell.flip7 && !cell.flip7To;
          td.innerHTML = `<span class="cell-box"><input type="text" class="cell-input${pts === 0 && !ownFlip7 ? " cell-zero" : ""}" value="${esc(String(pts))}" />${ownFlip7 ? '<span class="flip7-tag">+15</span>' : ""}</span>`;
          const input = td.querySelector("input");
          const box = td.querySelector(".cell-box");
          const setBadge = (on) => {
            const tag = box.querySelector(".flip7-tag");
            if (on && !tag)
              box.insertAdjacentHTML("beforeend", '<span class="flip7-tag">+15</span>');
            else if (!on && tag) tag.remove();
          };
          input.addEventListener("focus", () => {
            if (box.querySelector(".flip7-tag"))
              input.value = `${Number(input.value) || 0}+15`;
          });
          input.addEventListener("input", () => {
            const { points, flip7: f } = parseFlip7Input(input.value);
            setBadge(f);
            input.classList.toggle("cell-zero", points === 0 && !f);
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
          });
          const restoreDisplay = () => {
            input.value = String(pts);
            setBadge(ownFlip7);
            input.classList.toggle("cell-zero", pts === 0 && !ownFlip7);
          };
          input.addEventListener("blur", () => {
            const { points, flip7: f } = parseFlip7Input(input.value);
            // Editing never un-eliminates a Brutal player (their score is real).
            const bustCleared = !brutal && cell.bust && (points !== 0 || f);
            if (points === pts && f === ownFlip7 && !bustCleared) {
              restoreDisplay();
              return;
            }
            const g = getGame(game.id);
            const before = (winner(g) || {}).id || null;
            const c = g.rounds[ri].scores[p.id] || {
              points: 0,
              flip7: false,
              bust: false,
            };
            c.points = points;
            // Only touch the bonus when the badge state changed, so an untouched
            // Brutal redirect (flip7 + flip7To, shown badge-less) is preserved.
            if (f !== ownFlip7) {
              c.flip7 = f;
              if (c.flip7To) delete c.flip7To; // editing the badge cancels a redirect
            }
            if (bustCleared) c.bust = false;
            g.rounds[ri].scores[p.id] = c;
            upsertGame(g);
            this.changed(before);
          });
          tr.appendChild(td);
          return;
        }
        if (def.doubling) {
          const doubled = !cell.bust && !!cell.doubled;
          td.innerHTML = `<span class="cell-box"><input type="text" class="cell-input${pts === 0 && !doubled ? " cell-zero" : ""}" value="${esc(String(pts))}" />${doubled ? '<span class="flip7-tag dbl-tag">Doublé</span>' : ""}</span>`;
          const input = td.querySelector("input");
          const box = td.querySelector(".cell-box");
          const setBadge = (on) => {
            const tag = box.querySelector(".dbl-tag");
            if (on && !tag)
              box.insertAdjacentHTML(
                "beforeend",
                '<span class="flip7-tag dbl-tag">Doublé</span>',
              );
            else if (!on && tag) tag.remove();
          };
          input.addEventListener("focus", () => {
            if (box.querySelector(".dbl-tag"))
              input.value = `${Number(input.value) || 0}x2`;
          });
          input.addEventListener("input", () => {
            const { points, doubled: d2 } = parseSkyjoInput(input.value);
            setBadge(d2);
            input.classList.toggle("cell-zero", points === 0 && !d2);
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
          });
          const restoreDisplay = () => {
            input.value = String(pts);
            setBadge(doubled);
            input.classList.toggle("cell-zero", pts === 0 && !doubled);
          };
          input.addEventListener("blur", () => {
            const { points, doubled: d2 } = parseSkyjoInput(input.value);
            if (points === pts && d2 === doubled) {
              restoreDisplay();
              return;
            }
            const g = getGame(game.id);
            const before = (winner(g) || {}).id || null;
            const c = g.rounds[ri].scores[p.id] || { points: 0 };
            c.points = points;
            if (d2) c.doubled = true;
            else delete c.doubled;
            g.rounds[ri].scores[p.id] = c;
            upsertGame(g);
            this.changed(before);
          });
          tr.appendChild(td);
          return;
        }
        // Plain number (Time's Up!).
        td.innerHTML = `<span class="cell-box"><input type="number" class="cell-input${pts === 0 ? " cell-zero" : ""}" value="${pts}" /></span>`;
        const input = td.querySelector("input");
        input.addEventListener("input", () => {
          input.classList.toggle("cell-zero", (Number(input.value) || 0) === 0);
        });
        input.addEventListener("change", (e) => {
          const g = getGame(game.id);
          const before = (winner(g) || {}).id || null;
          const c = g.rounds[ri].scores[p.id] || { points: 0 };
          c.points = Number(e.target.value) || 0;
          g.rounds[ri].scores[p.id] = c;
          upsertGame(g);
          this.changed(before);
        });
        tr.appendChild(td);
      });

      const crown = won
        ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
        : "";
      tr.appendChild(
        el(
          `<td class="total-cell"><span class="score-badge rank${place}">${total}${crown}</span></td>`,
        ),
      );
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // footer: round delete buttons
    if (game.rounds.length) {
      let cells = `<td class="rank-col"></td><td class="player-name muted">Retirer</td>`;
      game.rounds.forEach((_, i) => {
        cells += `<td><button class="btn btn-danger btn-icon" data-delround="${i}" title="Supprimer la manche"><i class="fa-regular fa-xmark"></i></button></td>`;
      });
      cells += `<td></td>`;
      const tf = el(`<tfoot><tr>${cells}</tr></tfoot>`);
      table.appendChild(tf);
      tf.querySelectorAll("[data-delround]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ri = Number(btn.getAttribute("data-delround"));
          const ok = await confirmDialog({
            title: `Supprimer la manche ${ri + 1} ?`,
            body: "Les scores de cette manche seront supprimés pour tous les joueurs.",
            confirmLabel: "Supprimer",
            danger: true,
          });
          if (!ok) return;
          const g = getGame(game.id);
          g.rounds.splice(ri, 1);
          upsertGame(g);
          this.changed();
        });
      });
    }

    wrap.appendChild(table);
    this.replaceChildren(wrap);
  }
}

customElements.define("app-score-table", AppScoreTable);
