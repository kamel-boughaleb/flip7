/* <app-contree-table> — per-deal details for Contrée: bid, each team's deal
   score + running total; deals can be removed. Data in via `.game`; removing a
   deal writes to the store and emits a bubbling "changed" event so the details
   screen refreshes. */
import { esc } from "../util.js";
import { teamsOf, contreeBidHTML } from "../scoring.js";
import { getGame, upsertGame } from "../store.js";
import { confirmDialog } from "../ui.js";

class AppContreeTable extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  changed() {
    this.dispatchEvent(new CustomEvent("changed", { bubbles: true }));
  }

  render() {
    const game = this._g;
    if (!game) return;
    const teams = teamsOf(game);
    const running = { A: 0, B: 0 };
    const rows = !game.rounds.length
      ? `<tr><td colspan="5" class="turn-empty muted">Aucune donne jouée pour l'instant.</td></tr>`
      : game.rounds
          .map((r, i) => {
            running.A += Number(r.scores && r.scores.A) || 0;
            running.B += Number(r.scores && r.scores.B) || 0;
            const bidCell = r.bid
              ? contreeBidHTML(r.bid, game)
              : '<span class="muted">—</span>';
            return `<tr>
              <td class="rank-col"><span class="turn-num">${i + 1}</span></td>
              <td class="player-name">${bidCell}</td>
              <td class="total-cell">${Number(r.scores && r.scores.A) || 0}<span class="run-total">${running.A}</span></td>
              <td class="total-cell">${Number(r.scores && r.scores.B) || 0}<span class="run-total">${running.B}</span></td>
              <td class="rank-col"><button class="btn btn-danger btn-icon" data-deldeal="${i}" title="Supprimer la donne"><i class="fa-regular fa-xmark"></i></button></td>
            </tr>`;
          })
          .join("");
    this.innerHTML = `
      <div class="table-wrap">
        <table class="score turn-table">
          <thead><tr><th class="rank-col">Donne</th><th class="player-name">Mise</th><th>${esc(teams[0].name)}</th><th>${esc(teams[1].name)}</th><th class="rank-col"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    this.querySelectorAll("[data-deldeal]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.dataset.deldeal);
        const ok = await confirmDialog({
          title: `Supprimer la donne ${i + 1} ?`,
          body: "Les scores de cette donne seront supprimés.",
          confirmLabel: "Supprimer",
          danger: true,
        });
        if (!ok) return;
        const g = getGame(game.id);
        g.rounds.splice(i, 1);
        upsertGame(g);
        this.changed();
      });
    });
  }
}

customElements.define("app-contree-table", AppContreeTable);
