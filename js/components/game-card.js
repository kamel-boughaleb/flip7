/* <app-game-card> — one game in the home list.
   Light DOM (styled by styles.css via the .game-card class set on the host).
   Data in via the `.game` property; a click emits a bubbling "open" event
   carrying the game id, which the home screen turns into navigation. */
import { esc, fmtDuration } from "../util.js";
import { modeClass, modeLabel, unitOf } from "../rules.js";
import {
  winners,
  winnersLabel,
  roundCountLabel,
  roundNoteFor,
  gameDuration,
} from "../scoring.js";

class AppGameCard extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  connectedCallback() {
    if (!this._wired) {
      this.addEventListener("click", () => {
        if (this._g)
          this.dispatchEvent(
            new CustomEvent("open", { detail: this._g.id, bubbles: true }),
          );
      });
      this._wired = true;
    }
    if (this._g && !this.innerHTML) this.render();
  }

  render() {
    const g = this._g;
    if (!g) return;
    const ws = winners(g);
    const w = ws[0] || null;
    const ongoing = !g.cancelled && !w;
    const n = g.players.length;
    const u = unitOf(g.mode);
    const playersNote = n
      ? `${n} ${(n === 1 ? u.one : u.many).toLowerCase()}`
      : "Aucun joueur";
    let roundsNote = "";
    if (!ongoing) {
      roundsNote = ` · ${roundCountLabel(g, g.rounds.length)}`;
      const dur = gameDuration(g);
      if (dur != null) roundsNote += ` · ${fmtDuration(dur)}`;
    }
    const statusBadge = g.cancelled
      ? `<span class="badge cancelled"><i class="fa-regular fa-ban"></i> Annulée</span>`
      : w
        ? `<span class="badge rank1"><i class="fa-regular fa-trophy"></i> ${winnersLabel(ws)}</span>`
        : `<div class="status-cell">
             <span class="badge ongoing">En cours <i class="fa-regular fa-spinner-third fa-spin"></i></span>
             <span class="round-note">${roundNoteFor(g)}</span>
           </div>`;
    this.className =
      "game-card " + (g.cancelled ? "cancelled" : w ? "done" : "ongoing");
    this.innerHTML = `
      <div class="meta">
        <div class="name"><span class="name-text">${esc(g.name)}</span> <span class="badge badge-sm ${modeClass(g.mode)}">${esc(modeLabel(g.mode))}</span></div>
        <div class="sub">${esc(playersNote)}${roundsNote}</div>
      </div>
      ${statusBadge}`;
  }
}

customElements.define("app-game-card", AppGameCard);
