/* Shared reorderable player-list editor (used by Setup & Edit-players).
   Renders rows into `rowsEl`, mutating the `players` array in place; returns a
   redraw function. Supports drag-reorder, remove, and name autocompletion. */
import { el, esc } from "../util.js";
import { uid, getSelectedPlace, placePlayerNames } from "../store.js";

// Wire a custom name-autocomplete dropdown to an input + its sibling
// `.name-suggest` box. Shared by the player-list editor and the team builder so
// they behave identically. `getTaken` returns names to hide (already chosen);
// `onPick` runs when a suggestion is tapped. An in-flow block (not a fixed
// overlay) so it follows the input when the mobile keyboard resizes the view.
export function wireNameSuggest(input, box, { getSuggestions, getTaken, onPick }) {
  const renderList = () => {
    const q = (input.value || "").trim().toLowerCase();
    const taken = getTaken ? getTaken() : new Set();
    const matches = getSuggestions()
      .filter((n) => {
        const nl = n.toLowerCase();
        return !taken.has(nl) && nl !== q && (!q || nl.includes(q));
      })
      .slice(0, 6);
    if (!matches.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = matches
      .map((n) => `<button type="button" class="name-suggest-item">${esc(n)}</button>`)
      .join("");
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("focus", renderList);
  input.addEventListener("input", renderList);
  input.addEventListener("blur", () =>
    setTimeout(() => {
      box.hidden = true;
    }, 150),
  );
  box.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".name-suggest-item");
    if (!btn) return;
    e.preventDefault();
    input.value = btn.textContent;
    box.hidden = true;
    if (onPick) onPick(btn.textContent);
  });
}

export function renderPlayerRows(
  rowsEl,
  players,
  { allowRemove = true, placeholder = "Nom du joueur", suggestions } = {},
) {
  // placeholder may be a function so it tracks the dialog's selected game.
  const phText = () =>
    typeof placeholder === "function" ? placeholder() : placeholder;
  // allowRemove may be a function so it can react to the selected game (Contrée
  // has a fixed 4-player roster: no remove, but rows stay reorderable).
  const canRemove = () =>
    typeof allowRemove === "function" ? allowRemove() : allowRemove;
  // Autocompletion source; may be a function so it tracks the selected game
  // (player names vs team names). A custom dropdown is used instead of
  // <datalist>, whose mobile support is unreliable.
  const getSuggestions = () =>
    typeof suggestions === "function"
      ? suggestions()
      : suggestions || placePlayerNames(getSelectedPlace());
  let dragSrc = null;

  // Wire the shared name-autocomplete dropdown to a row's name input.
  function wireSuggestions(input, i) {
    const box = input.parentElement.querySelector(".name-suggest");
    wireNameSuggest(input, box, {
      getSuggestions,
      // Hide names already chosen in other rows.
      getTaken: () =>
        new Set(
          players
            .filter((_, k) => k !== i)
            .map((p) => (p.name || "").trim().toLowerCase())
            .filter(Boolean),
        ),
      onPick: (name) => {
        players[i].name = name;
        revalidate(i);
      },
    });
  }

  // Index of the row whose upper half currently contains pointer Y, i.e. the
  // insertion target. Falls back to the last row when below every center.
  // Insertion index among the rows EXCLUDING the one being dragged (it's removed
  // on drop), so the indicator and the final position match — and the last slot
  // is reachable (returns rows.length).
  function rowIndexAtY(y) {
    const rows = [...rowsEl.querySelectorAll(".player-row:not(.dragging)")];
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) return j;
    }
    return rows.length;
  }

  function clearHints() {
    rowsEl
      .querySelectorAll(".player-row")
      .forEach((r) => r.classList.remove("drag-over", "dragging"));
    rowsEl.querySelectorAll(".drop-indicator").forEach((e) => e.remove());
  }
  // Line showing where the dragged row will land (before row[index], or end).
  function showIndicator(index) {
    const rows = [...rowsEl.querySelectorAll(".player-row:not(.dragging)")];
    const ind = el(`<div class="drop-indicator"></div>`);
    if (index >= rows.length) rowsEl.appendChild(ind);
    else rowsEl.insertBefore(ind, rows[index]);
  }

  function draw() {
    rowsEl.innerHTML = "";
    players.forEach((p, i) => {
      const row = el(`
        <div class="player-row" data-i="${i}">
          <span class="drag-handle" title="Déplacer"><i class="fa-regular fa-grip-dots-vertical"></i></span>
          <div class="player-input-wrap">
            <div class="name-field">
              <input type="text" placeholder="${esc(phText())}" value="${esc(p.name)}" autocomplete="off" />
              <div class="name-suggest" hidden></div>
            </div>
            <div class="player-error" hidden></div>
          </div>
          ${canRemove() ? `<button class="btn btn-danger btn-icon" title="Retirer"><i class="fa-regular fa-xmark"></i></button>` : ""}
        </div>`);
      const input = row.querySelector("input");
      input.addEventListener("input", (e) => {
        players[i].name = e.target.value;
        revalidate(i);
      });
      wireSuggestions(input, i);
      if (canRemove()) {
        row.querySelector("button").addEventListener("click", () => {
          players.splice(i, 1);
          if (!players.length) players.push({ id: uid(), name: "" });
          draw();
        });
      }

      const handle = row.querySelector(".drag-handle");
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragSrc = i;
        row.classList.add("dragging");
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (dragSrc === null) return;
        e.preventDefault();
        // Measure on the clean layout, then show the insertion line.
        rowsEl.querySelectorAll(".drop-indicator").forEach((x) => x.remove());
        showIndicator(rowIndexAtY(e.clientY));
      });
      const finish = (e) => {
        if (dragSrc === null) return;
        rowsEl.querySelectorAll(".drop-indicator").forEach((x) => x.remove());
        // `j` excludes the dragged row, so removing src then inserting at j is
        // correct directly (no off-by-one).
        const j = rowIndexAtY(e.clientY);
        const src = dragSrc;
        dragSrc = null;
        const moved = players.splice(src, 1)[0];
        players.splice(j, 0, moved);
        draw();
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", () => {
        dragSrc = null;
        clearHints();
      });

      rowsEl.appendChild(row);
    });
    revalidate(null);
  }

  // Outline duplicate-name inputs in red; show a message under the row that was
  // just edited (focusIndex), if its name collides with another.
  function revalidate(focusIndex) {
    const counts = {};
    players.forEach((p) => {
      const k = (p.name || "").trim().toLowerCase();
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    [...rowsEl.querySelectorAll(".player-row")].forEach((row, idx) => {
      const input = row.querySelector("input");
      const errEl = row.querySelector(".player-error");
      const k = (players[idx].name || "").trim().toLowerCase();
      const isDup = !!k && counts[k] > 1;
      input.classList.toggle("dup", isDup);
      if (isDup && idx === focusIndex) {
        errEl.textContent = "Ce joueur est déjà dans la partie";
        errEl.hidden = false;
      } else {
        errEl.textContent = "";
        errEl.hidden = true;
      }
    });
  }

  draw();
  return draw;
}

