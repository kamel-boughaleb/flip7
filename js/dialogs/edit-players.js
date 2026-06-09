/* Edit-players dialog: rename/reorder a game's roster (and switch its type
   when no round has been played yet). */
import { el, esc, toast, firstDuplicateName } from "../util.js";
import {
  uid,
  getGame,
  upsertGame,
  placePlayerNames,
  getSelectedPlace,
} from "../store.js";
import {
  MODES,
  DEFAULT_MODE,
  defFor,
  rulesetOf,
  unitOf,
  unitKeyOf,
  modeTabsHTML,
} from "../rules.js";
import { winner } from "../scoring.js";
import { go } from "../nav.js";
import { renderPlayerRows } from "./player-rows.js";
import { renderTeamBuilder, makeTeam } from "./team-builder.js";

export function openEditPlayersDialog(game) {
  const id = game.id;
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  let players = game.players.map((p) => ({ ...p }));
  // A finished or cancelled game keeps its roster fixed — no add/remove.
  const locked = !!winner(game);
  let mode = MODES[game.mode] ? game.mode : DEFAULT_MODE;
  let yamsChance = !!game.yamsChance; // Yam's-only option: the Chance case
  // Once Chance has been scored by anyone, it can't be turned off (doing so
  // would discard real scores) — the toggle stays locked on.
  const chancePlayed = game.rounds.some((r) => {
    const cell = Object.values(r.scores)[0];
    return cell && cell.category === "chance";
  });
  // Time's Up! team builder: load this game's teams (or defaults if converting).
  let teams = defFor(game).teamBuilder
    ? game.players.map((t) => ({
        id: t.id || uid(),
        name: t.name || "",
        members: (t.members || []).map((m) => ({
          id: m.id || uid(),
          name: m.name || "",
        })),
      }))
    : [];
  while (teams.length < 2) teams.push(makeTeam(teams));
  let rosterDraw = () => {};

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Modifier la partie</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Type de partie</label>
        <div class="mode-tabs" id="modeTabs">${modeTabsHTML()}</div>
      </div>
      <div class="field" id="targetField" hidden>
        <label for="targetInput">Score cible</label>
        <input type="number" inputmode="numeric" class="cell-input target-input" id="targetInput" value="${esc(game.target != null ? String(game.target) : "")}" />
      </div>
      <div class="field" id="yamsOptField" hidden>
        <label>Options</label>
        <button type="button" class="setup-opt${yamsChance ? " active" : ""}${chancePlayed ? " disabled" : ""}" id="yamsChanceToggle" aria-pressed="${yamsChance}"${chancePlayed ? ' title="Déjà jouée — non désactivable"' : ""}>
          <span class="setup-opt-main">
            <span class="setup-opt-name">Chance</span>
            <span class="setup-opt-desc muted">${chancePlayed ? "Déjà jouée : la case ne peut plus être retirée." : "Ajoute une 13ᵉ case : la somme des 5 dés."}</span>
          </span>
          <span class="setup-opt-switch" aria-hidden="true"></span>
        </button>
      </div>
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        ${locked ? "" : `<button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>`}
        <p class="teams-hint" id="teamsHint" hidden></p>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="save">Enregistrer</button>
    </div>`;

  const rowsEl = modal.querySelector("#rows");
  const addBtn = modal.querySelector("#addPlayer");
  const playersLabel = modal.querySelector("#playersLabel");
  // Reflect the selected game's wording (players vs teams).
  const applyUnit = () => {
    const u = unitOf(mode);
    playersLabel.textContent = u.many;
    if (addBtn) addBtn.textContent = `+ ${u.add}`;
    rowsEl
      .querySelectorAll('input[type="text"]')
      .forEach((i) => (i.placeholder = u.placeholder));
  };

  // Conversions that would change the round structure are locked once scores
  // exist: turn-based (Qwirkle) and team (Contrée) games store rounds
  // differently, so a started game can't switch to/from them.
  const hasRounds = game.rounds.length > 0;
  const curTurn = !!defFor(game).turnBased;
  const curTeams = !!defFor(game).teams;
  const curBombu = defFor(game).entry === "bombu";
  const curBuilder = !!defFor(game).teamBuilder;
  const isTeams = () => rulesetOf(mode).teams;
  // Games with a fixed roster: Contrée (teams, 4) and Bombu (fixedPlayers: 4).
  const fixedCount = () => (isTeams() ? 4 : rulesetOf(mode).fixedPlayers || 0);
  // Time's Up!: the roster is a team builder instead of a flat player list.
  const useTeamBuilder = () => !!rulesetOf(mode).teamBuilder;
  function mountRoster() {
    if (useTeamBuilder()) {
      rosterDraw = renderTeamBuilder(rowsEl, teams, {
        onChange: () => {},
        suggestions: () => placePlayerNames(getSelectedPlace(), "joueur"),
      });
    } else {
      rosterDraw = renderPlayerRows(rowsEl, players, {
        allowRemove: () => !locked && !fixedCount(),
        placeholder: () => unitOf(mode).placeholder,
        suggestions: () => placePlayerNames(getSelectedPlace(), unitKeyOf(mode)),
      });
    }
  }
  // Carry the typed names across when switching between the flat player list and
  // the team builder, so changing the game type doesn't lose them.
  let lastBuilder = useTeamBuilder();
  function syncRoster(nowBuilder) {
    if (nowBuilder === lastBuilder) return;
    if (nowBuilder) {
      const names = players.map((p) => (p.name || "").trim()).filter(Boolean);
      if (names.length) {
        teams.forEach((t) => (t.members = []));
        names.forEach((n, i) =>
          teams[i % teams.length].members.push({ id: uid(), name: n }),
        );
        teams.forEach((t) => {
          if (!t.members.length) t.members.push({ id: uid(), name: "" });
        });
      }
    } else {
      const names = teams
        .flatMap((t) => t.members.map((m) => (m.name || "").trim()))
        .filter(Boolean);
      players = names.length
        ? names.map((n) => ({ id: uid(), name: n }))
        : [{ id: uid(), name: "" }, { id: uid(), name: "" }];
      while (players.length < 2) players.push({ id: uid(), name: "" });
    }
    lastBuilder = nowBuilder;
  }
  const modeTabs = modal.querySelector("#modeTabs");
  const tabBtns = modeTabs.querySelectorAll(".mode-tab");
  tabBtns.forEach((b) => {
    const r = rulesetOf(b.dataset.mode);
    // Bombu and Time's Up! store their roster/rounds differently, so they can't
    // be switched to/from once the game has started.
    if (
      hasRounds &&
      (!!r.turnBased !== curTurn ||
        !!r.teams !== curTeams ||
        (r.entry === "bombu") !== curBombu ||
        !!r.teamBuilder !== curBuilder)
    ) {
      b.disabled = true;
      b.classList.add("disabled");
      b.title = "Partie déjà commencée — type de jeu non modifiable";
    }
  });
  const targetField = modal.querySelector("#targetField");
  const targetInput = modal.querySelector("#targetInput");
  const yamsOptField = modal.querySelector("#yamsOptField");
  const yamsChanceToggle = modal.querySelector("#yamsChanceToggle");
  const teamsHint = modal.querySelector("#teamsHint");
  // Contrée: A = seats 1 & 3, B = seats 2 & 4. Live preview under the roster.
  const updateTeamsHint = () => {
    if (!isTeams()) return (teamsHint.hidden = true);
    teamsHint.hidden = false;
    const nm = (i) => (players[i] && players[i].name.trim()) || `Joueur ${i + 1}`;
    teamsHint.innerHTML = `<b>Équipe A</b> : ${esc(nm(0))} & ${esc(nm(2))} · <b>Équipe B</b> : ${esc(nm(1))} & ${esc(nm(3))}`;
  };
  // Team games keep a fixed roster (no add/remove); games with a configurable
  // target (Contrée) expose the score-target field.
  const applyRoster = () => {
    syncRoster(useTeamBuilder()); // carry names over when the roster type flips
    if (addBtn)
      addBtn.style.display = useTeamBuilder() || fixedCount() ? "none" : "";
    targetField.hidden = !rulesetOf(mode).configurableTarget;
    yamsOptField.hidden = mode !== "yams";
    mountRoster();
    updateTeamsHint();
  };
  const syncModeTabs = () =>
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  tabBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (b.disabled) return;
      mode = b.dataset.mode;
      syncModeTabs();
      applyUnit();
      applyRoster(); // mounts the roster for the new mode
    }),
  );
  syncModeTabs();

  applyUnit();
  applyRoster(); // mounts the roster
  // Keep the teams preview in sync with name edits and reordering.
  rowsEl.addEventListener("input", updateTeamsHint);
  rowsEl.addEventListener("pointerup", () => setTimeout(updateTeamsHint, 0));
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (useTeamBuilder()) {
        teams.push(makeTeam(teams));
        rosterDraw();
        const cards = rowsEl.querySelectorAll(".team-card");
        if (cards.length)
          cards[cards.length - 1].querySelector(".team-name").focus();
      } else {
        players.push({ id: uid(), name: "" });
        rosterDraw();
        rowsEl.querySelector(".player-row:last-child input").focus();
      }
    });
  }

  yamsChanceToggle.addEventListener("click", () => {
    if (chancePlayed) return; // locked on — can't discard played Chance cells
    yamsChance = !yamsChance;
    yamsChanceToggle.classList.toggle("active", yamsChance);
    yamsChanceToggle.setAttribute("aria-pressed", String(yamsChance));
  });

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  modal.querySelector("#save").addEventListener("click", () => {
    const def = rulesetOf(mode);
    // Time's Up!: rebuild the teams (named players) from the builder.
    if (def.teamBuilder) {
      const built = teams
        .map((t) => ({
          id: t.id,
          name: t.name.trim(),
          members: t.members
            .map((m) => ({ id: m.id, name: m.name.trim() }))
            .filter((m) => m.name),
        }))
        .filter((t) => t.name || t.members.length);
      if (built.length < 2) return toast("Au moins 2 équipes requises");
      for (const t of built)
        if (!t.name) return toast("Donnez un nom à chaque équipe");
      const dupT = firstDuplicateName(built.map((t) => t.name));
      if (dupT) return toast(`L'équipe « ${dupT} » est en double`);
      const dupP = firstDuplicateName(
        built.flatMap((t) => t.members.map((m) => m.name)),
      );
      if (dupP) return toast(`« ${dupP} » est présent dans deux équipes`);
      const g = getGame(id);
      g.players = built;
      g.mode = mode; // switching to/from Time's Up! is gated by the tab lock
      g.target = def.target;
      delete g.yamsChance;
      upsertGame(g);
      overlay.remove();
      return go("game", { id });
    }
    const valid = players.filter((p) => p.name.trim());
    if (def.teams) {
      if (valid.length !== 4)
        return toast("La Contrée se joue à exactement 4 joueurs");
    } else if (def.fixedPlayers) {
      if (valid.length !== def.fixedPlayers)
        return toast(`Le Bombu se joue à exactement ${def.fixedPlayers} joueurs`);
    } else if (valid.length < 2) {
      return toast("Au moins 2 joueurs requis");
    }
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    const g = getGame(id);
    g.players = valid.map((p) => ({ id: p.id, name: p.name.trim() }));
    // Never switch a started game to/from a turn-based or team type.
    const cur = defFor(g);
    const incompatible =
      g.rounds.length > 0 &&
      (!!def.turnBased !== !!cur.turnBased ||
        !!def.teams !== !!cur.teams ||
        (def.entry === "bombu") !== (cur.entry === "bombu"));
    const safeMode = incompatible ? g.mode : mode;
    g.mode = safeMode;
    const sdef = rulesetOf(safeMode);
    // Configurable target (Contrée): read the field; else follow the ruleset.
    if (sdef.configurableTarget) {
      const t = Number(targetInput.value) || 0;
      if (t <= 0) return toast("Indiquez un score cible valide");
      g.target = t;
    } else {
      g.target = sdef.target;
    }
    // Yam's Chance option: store the flag, and if it was turned off drop any
    // Chance cells already entered so totals and completion stay consistent.
    if (safeMode === "yams" && yamsChance) {
      g.yamsChance = true;
    } else {
      delete g.yamsChance;
      g.rounds = g.rounds.filter((r) => {
        const cell = Object.values(r.scores)[0];
        return !(cell && cell.category === "chance");
      });
    }
    upsertGame(g);
    overlay.remove();
    go("game", { id });
  });

  root.appendChild(overlay);
}
