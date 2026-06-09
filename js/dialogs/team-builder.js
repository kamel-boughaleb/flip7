/* Team builder for Time's Up! (Setup & Edit). Edits `teams` in place — each is
   { id, name, members: [{ id, name }] } — and returns a redraw fn. Teams get a
   random name from a list (no manual naming); players can be added/removed,
   dragged between teams, autocompleted, and shuffled randomly across teams.
   opts: { onChange?, suggestions?: () => string[] }. */
import { el, esc } from "../util.js";
import { uid } from "../store.js";
import { wireNameSuggest } from "./player-rows.js";

// Pool of fun team names; each team gets a distinct one at random.
const TEAM_NAMES = [
  "Les Lions", "Les Tigres", "Les Aigles", "Les Loups", "Les Renards",
  "Les Panthères", "Les Faucons", "Les Dragons", "Les Requins", "Les Ours",
  "Les Cobras", "Les Pumas", "Les Bisons", "Les Hiboux", "Les Vipères",
  "Les Lynx", "Les Castors", "Les Jaguars", "Les Taureaux", "Les Guépards",
];

// A random team name not already used by the given teams (falls back to a
// numbered name if the pool is exhausted).
export function randomTeamName(teams) {
  const used = new Set(teams.map((t) => (t.name || "").trim().toLowerCase()));
  const free = TEAM_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (!free.length) return `Équipe ${teams.length + 1}`;
  return free[Math.floor(Math.random() * free.length)];
}

// A fresh team with a random unused name and one empty player slot.
export function makeTeam(teams) {
  return { id: uid(), name: randomTeamName(teams), members: [{ id: uid(), name: "" }] };
}

export function renderTeamBuilder(container, teams, opts = {}) {
  const notify = () => opts.onChange && opts.onChange();
  const getSuggestions = () => (opts.suggestions ? opts.suggestions() : []);
  let drag = null; // member being moved, as {ti, mi}

  // Randomly spread every named player across the existing teams (round-robin).
  function shuffle() {
    const all = [];
    teams.forEach((t) =>
      t.members.forEach((m) => {
        if ((m.name || "").trim()) all.push(m);
      }),
    );
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    teams.forEach((t) => (t.members = []));
    all.forEach((m, i) => teams[i % teams.length].members.push(m));
    draw();
    notify();
  }

  function dropTarget(y) {
    const cards = [...container.querySelectorAll(".team-card")];
    let ti = cards.length - 1;
    for (let k = 0; k < cards.length; k++) {
      if (y < cards[k].getBoundingClientRect().bottom) {
        ti = k;
        break;
      }
    }
    // Exclude the row being dragged: the index must be relative to the list
    // WITHOUT it (it's removed on drop), so the line matches the final slot.
    const rows = [...cards[ti].querySelectorAll(".team-member:not(.dragging)")];
    let index = rows.length;
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = j;
        break;
      }
    }
    return { ti, index };
  }

  const clearIndicator = () =>
    container.querySelectorAll(".drop-indicator").forEach((e) => e.remove());
  const clearDropHints = () => {
    container
      .querySelectorAll(".team-card")
      .forEach((c) => c.classList.remove("drag-over"));
    clearIndicator();
  };
  // Show a line at the exact slot where the dragged player would land.
  function showIndicator(ti, index) {
    const card = container.querySelectorAll(".team-card")[ti];
    if (!card) return;
    const membersEl = card.querySelector(".team-members");
    const rows = [...membersEl.querySelectorAll(".team-member:not(.dragging)")];
    const ind = el(`<div class="drop-indicator"></div>`);
    if (index >= rows.length) membersEl.appendChild(ind);
    else membersEl.insertBefore(ind, rows[index]);
  }

  function draw() {
    container.innerHTML = "";

    teams.forEach((t, ti) => {
      const card = el(`
        <div class="team-card" data-ti="${ti}">
          <div class="team-head">
            <span class="team-name">${esc(t.name || "")}</span>
            <button type="button" class="btn btn-ghost btn-icon team-reroll" title="Autre nom"><i class="fa-regular fa-dice"></i></button>
            <button type="button" class="btn btn-danger btn-icon team-remove" title="Supprimer l'équipe"><i class="fa-regular fa-xmark"></i></button>
          </div>
          <div class="team-members"></div>
          <button type="button" class="btn btn-ghost btn-sm team-add-player"><i class="fa-regular fa-plus"></i> Ajouter un joueur</button>
        </div>`);
      // Re-roll this team's name (kept distinct from the others).
      card.querySelector(".team-reroll").addEventListener("click", () => {
        t.name = randomTeamName(teams.filter((_, k) => k !== ti));
        draw();
        notify();
      });
      card.querySelector(".team-remove").addEventListener("click", () => {
        teams.splice(ti, 1);
        draw();
        notify();
      });

      const membersEl = card.querySelector(".team-members");
      t.members.forEach((mem, mi) => {
        const row = el(`
          <div class="team-member" data-ti="${ti}" data-mi="${mi}">
            <span class="drag-handle" title="Déplacer"><i class="fa-regular fa-grip-dots-vertical"></i></span>
            <div class="name-field">
              <input type="text" placeholder="Nom du joueur" value="${esc(mem.name || "")}" autocomplete="off" />
              <div class="name-suggest" hidden></div>
            </div>
            <button type="button" class="btn btn-danger btn-icon" title="Retirer"><i class="fa-regular fa-xmark"></i></button>
          </div>`);
        const inp = row.querySelector("input");
        inp.addEventListener("input", () => {
          mem.name = inp.value;
          notify();
        });
        // Same name-autocomplete as the other setups.
        wireNameSuggest(inp, row.querySelector(".name-suggest"), {
          getSuggestions,
          getTaken: () =>
            new Set(
              teams
                .flatMap((tt) => tt.members)
                .filter((m) => m !== mem)
                .map((m) => (m.name || "").trim().toLowerCase())
                .filter(Boolean),
            ),
          onPick: (name) => {
            mem.name = name;
            notify();
          },
        });
        row.querySelector("button").addEventListener("click", () => {
          t.members.splice(mi, 1);
          draw();
          notify();
        });

        const handle = row.querySelector(".drag-handle");
        handle.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          drag = { ti, mi };
          row.classList.add("dragging");
          handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener("pointermove", (e) => {
          if (!drag) return;
          e.preventDefault();
          // Clear last frame's indicator first so the measurement is on the
          // clean layout, then highlight the target team and show the slot.
          clearIndicator();
          const { ti: dti, index } = dropTarget(e.clientY);
          showIndicator(dti, index);
        });
        const finish = (e) => {
          if (!drag) return;
          // Remove the indicator BEFORE measuring, so its height doesn't shift
          // the rows and skew the drop index (otherwise "last" is unreachable).
          clearIndicator();
          const { ti: dti, index } = dropTarget(e.clientY);
          const src = drag;
          drag = null;
          clearDropHints();
          // `index` already excludes the dragged member, so after removing it
          // from its source team we insert at `index` directly (no adjustment).
          const moved = teams[src.ti].members.splice(src.mi, 1)[0];
          teams[dti].members.splice(index, 0, moved);
          draw();
          notify();
        };
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", () => {
          drag = null;
          clearDropHints();
        });

        membersEl.appendChild(row);
      });

      card.querySelector(".team-add-player").addEventListener("click", () => {
        t.members.push({ id: uid(), name: "" });
        draw();
        const cards = container.querySelectorAll(".team-card");
        const inputs = cards[ti]
          ? cards[ti].querySelectorAll(".team-member input")
          : [];
        if (inputs.length) inputs[inputs.length - 1].focus();
        notify();
      });

      container.appendChild(card);
    });

    // Footer: "Ajouter une équipe" on one side, "Mélanger" opposite it.
    const playerCount = teams.reduce(
      (n, t) => n + t.members.filter((m) => (m.name || "").trim()).length,
      0,
    );
    const tools = el(`
      <div class="team-tools">
        <button type="button" class="btn btn-ghost btn-sm" id="teamAdd"><i class="fa-regular fa-plus"></i> Ajouter une équipe</button>
        <button type="button" class="btn btn-ghost btn-sm" id="teamShuffle"${teams.length >= 2 && playerCount >= 2 ? "" : " disabled"}><i class="fa-regular fa-shuffle"></i> Mélanger les joueurs</button>
      </div>`);
    tools.querySelector("#teamAdd").addEventListener("click", () => {
      teams.push(makeTeam(teams));
      draw();
      const cards = container.querySelectorAll(".team-card");
      if (cards.length) cards[cards.length - 1].scrollIntoView({ block: "nearest" });
      notify();
    });
    tools.querySelector("#teamShuffle").addEventListener("click", shuffle);
    container.appendChild(tools);
  }

  draw();
  return draw;
}
