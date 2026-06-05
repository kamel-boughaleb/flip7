/* Rules dialog (opened from the top-bar book button): a tabbed view of every
   game's rules. Defaults to the current game's mode when viewing one. */
import { el, esc } from "../util.js";
import { MODES, rulesFor } from "../rules.js";
import { getGame } from "../store.js";
import { currentRoute } from "../nav.js";

let rulesTab = "classic";

export function openRulesDialog() {
  // When viewing a game, default the rules to that game's mode.
  const r = currentRoute();
  if (["game", "details", "entry"].includes(r.name) && r.id) {
    const g = getGame(r.id);
    if (g && MODES[g.mode]) rulesTab = g.mode;
  }
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-rules"></div>`);
  overlay.appendChild(modal);

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3><i class="fa-regular fa-book-open"></i> Règles</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="rules-dialog-body"></div>`;
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", () => overlay.remove());
  const body = modal.querySelector(".rules-dialog-body");

  function draw() {
    body.innerHTML = `
      <div class="rules-tabs">
        ${Object.entries(MODES)
          .map(
            ([key, m]) =>
              `<button class="rules-tab ${rulesTab === key ? "active" : ""}" data-tab="${key}">${esc(m.label)}</button>`,
          )
          .join("")}
      </div>
      <div class="rules">${rulesFor(rulesTab)}</div>`;
    body.querySelectorAll(".rules-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        rulesTab = btn.getAttribute("data-tab");
        draw();
      });
    });
  }
  draw();

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}
