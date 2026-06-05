/* Shared reorderable player-list editor (used by Setup & Edit-players).
   Renders rows into `rowsEl`, mutating the `players` array in place; returns a
   redraw function. Supports drag-reorder, remove, and name autocompletion. */
import { el, esc } from "../util.js";
import { uid, getSelectedPlace, placePlayerNames } from "../store.js";

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

  // Wire a custom suggestions dropdown to a row's name input. The dropdown is
  // an in-flow block right under the input (inside the scrollable dialog body)
  // so it follows the input — unlike a position:fixed overlay, it doesn't drift
  // when the mobile keyboard resizes the viewport, and it's never clipped.
  function wireSuggestions(input, i) {
    const box = input.parentElement.querySelector(".name-suggest");
    const renderList = () => {
      const q = (input.value || "").trim().toLowerCase();
      // Hide names already chosen in other rows + the current exact value.
      const taken = new Set(
        players
          .filter((_, k) => k !== i)
          .map((p) => (p.name || "").trim().toLowerCase())
          .filter(Boolean),
      );
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
        .map(
          (n) =>
            `<button type="button" class="name-suggest-item">${esc(n)}</button>`,
        )
        .join("");
      box.hidden = false;
      // Keep the list in view (e.g. when the keyboard just opened).
      box.scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("focus", renderList);
    input.addEventListener("input", renderList);
    // Delay so a tap on an item registers before the list hides.
    input.addEventListener("blur", () =>
      setTimeout(() => {
        box.hidden = true;
      }, 150),
    );
    // pointerdown (not click) fires before blur — works for touch and mouse.
    box.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".name-suggest-item");
      if (!btn) return;
      e.preventDefault();
      input.value = btn.textContent;
      players[i].name = btn.textContent;
      box.hidden = true;
      revalidate(i);
    });
  }

  // Index of the row whose upper half currently contains pointer Y, i.e. the
  // insertion target. Falls back to the last row when below every center.
  function rowIndexAtY(y) {
    const rows = [...rowsEl.querySelectorAll(".player-row")];
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) return j;
    }
    return rows.length - 1;
  }

  function clearHints() {
    rowsEl
      .querySelectorAll(".player-row")
      .forEach((r) => r.classList.remove("drag-over", "dragging"));
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
        const j = rowIndexAtY(e.clientY);
        rowsEl
          .querySelectorAll(".player-row")
          .forEach((r, k) =>
            r.classList.toggle("drag-over", k === j && j !== dragSrc),
          );
      });
      const finish = (e) => {
        if (dragSrc === null) return;
        const j = rowIndexAtY(e.clientY);
        const src = dragSrc;
        dragSrc = null;
        if (j !== src) {
          const moved = players.splice(src, 1)[0];
          players.splice(j, 0, moved);
        }
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

