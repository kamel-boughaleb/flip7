/* New-game setup dialog: pick the game type, edit the roster, start. */
import { el, esc, toast, gameNameFromDate, firstDuplicateName } from "../util.js";
import {
  uid,
  getSelectedPlace,
  upsertGame,
  placePlayerNames,
} from "../store.js";
import {
  MODES,
  DEFAULT_MODE,
  rulesetOf,
  unitOf,
  unitKeyOf,
  modeTabsHTML,
} from "../rules.js";
import { go } from "../nav.js";
import { renderPlayerRows } from "./player-rows.js";
import { renderTeamBuilder, makeTeam } from "./team-builder.js";

export function openSetupDialog(opts = {}) {
  const place = getSelectedPlace();
  if (place === null) return toast("Ajoutez ou choisissez un lieu d'abord");
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  let players =
    opts.prefill && opts.prefill.length
      ? opts.prefill.map((n) => ({ id: uid(), name: n }))
      : [
          { id: uid(), name: "" },
          { id: uid(), name: "" },
        ];
  let mode = opts.mode && MODES[opts.mode] ? opts.mode : DEFAULT_MODE;
  // Replaying a game carries its parameters over (target, Chance…).
  let yamsChance = !!opts.yamsChance; // Yam's-only option: add the Chance case
  let brutalMode = !!opts.brutalMode; // Vengeance-only option: the Brutal variant
  // Time's Up! builds teams of named players here (carried over on replay/edit).
  // Only adopt incoming teams when the (replayed) game is itself a team-builder
  // game; otherwise opts.teams would be individual players, not real teams.
  let teams =
    opts.teams && opts.teams.length && rulesetOf(mode).teamBuilder
      ? opts.teams.map((t) => ({
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
      <h3>Nouvelle partie</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Type de partie</label>
        <div class="mode-tabs" id="modeTabs">${modeTabsHTML()}</div>
      </div>
      <div class="field" id="targetField" hidden>
        <label for="targetInput">Score cible</label>
        <input type="number" inputmode="numeric" class="cell-input target-input" id="targetInput" placeholder="2000" value="${opts.target != null ? esc(String(opts.target)) : "2000"}" />
      </div>
      <div class="field" id="yamsOptField" hidden>
        <label>Options</label>
        <button type="button" class="setup-opt${yamsChance ? " active" : ""}" id="yamsChanceToggle" aria-pressed="${yamsChance}">
          <span class="setup-opt-main">
            <span class="setup-opt-name">Chance</span>
            <span class="setup-opt-desc muted">Ajoute une 13ᵉ case : la somme des 5 dés.</span>
          </span>
          <span class="setup-opt-switch" aria-hidden="true"></span>
        </button>
      </div>
      <div class="field" id="brutalOptField" hidden>
        <label>Options</label>
        <button type="button" class="setup-opt${brutalMode ? " active" : ""}" id="brutalToggle" aria-pressed="${brutalMode}">
          <span class="setup-opt-main">
            <span class="setup-opt-name">Mode Brutal</span>
            <span class="setup-opt-desc muted">Scores négatifs, joueur éliminé scorable, et Flip 7 à +15 pour soi ou −15 à un adversaire.</span>
          </span>
          <span class="setup-opt-switch" aria-hidden="true"></span>
        </button>
      </div>
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        <button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>
        <p class="teams-hint" id="teamsHint" hidden></p>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="start">Commencer la partie</button>
    </div>`;

  const rowsEl = modal.querySelector("#rows");
  const addBtn = modal.querySelector("#addPlayer");
  const playersLabel = modal.querySelector("#playersLabel");
  const targetField = modal.querySelector("#targetField");
  const targetInput = modal.querySelector("#targetInput");
  const yamsOptField = modal.querySelector("#yamsOptField");
  const yamsChanceToggle = modal.querySelector("#yamsChanceToggle");
  const brutalOptField = modal.querySelector("#brutalOptField");
  const brutalToggle = modal.querySelector("#brutalToggle");
  const teamsHint = modal.querySelector("#teamsHint");
  const isTeams = () => rulesetOf(mode).teams;
  // Games with a fixed roster: Contrée (teams, 4) and Bombu (fixedPlayers: 4).
  const fixedCount = () =>
    isTeams() ? 4 : rulesetOf(mode).fixedPlayers || 0;
  // Time's Up!: the roster is a team builder instead of a flat player list.
  const useTeamBuilder = () => !!rulesetOf(mode).teamBuilder;
  // Mount the right roster editor for the current mode (re-runs on mode switch).
  function mountRoster() {
    if (useTeamBuilder()) {
      rosterDraw = renderTeamBuilder(rowsEl, teams, {
        onChange: () => {},
        suggestions: () => placePlayerNames(place, "joueur"),
      });
    } else {
      rosterDraw = renderPlayerRows(rowsEl, players, {
        allowRemove: () => !fixedCount(),
        placeholder: () => unitOf(mode).placeholder,
        suggestions: () => placePlayerNames(place, unitKeyOf(mode)),
      });
    }
  }
  // Carry the typed names across when switching between a flat player list and
  // the team builder, so changing the game type mid-setup doesn't lose them.
  let lastBuilder = useTeamBuilder();
  function syncRoster(nowBuilder) {
    if (nowBuilder === lastBuilder) return;
    if (nowBuilder) {
      // → team builder: spread the typed players across the teams.
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
      // → flat list: collect every team member back into the player list.
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
  // Reflect the selected game's wording (players vs teams).
  const applyUnit = () => {
    const u = unitOf(mode);
    playersLabel.textContent = u.many;
    addBtn.textContent = `+ ${u.add}`;
    rowsEl
      .querySelectorAll('input[type="text"]')
      .forEach((i) => (i.placeholder = u.placeholder));
  };
  // Contrée: A = seats 1 & 3, B = seats 2 & 4. Refresh the live preview.
  const updateTeamsHint = () => {
    if (!isTeams()) return (teamsHint.hidden = true);
    teamsHint.hidden = false;
    const nm = (i) => (players[i] && players[i].name.trim()) || `Joueur ${i + 1}`;
    teamsHint.innerHTML = `<b>Équipe A</b> : ${esc(nm(0))} & ${esc(nm(2))} · <b>Équipe B</b> : ${esc(nm(1))} & ${esc(nm(3))}`;
  };
  // Show/hide the score-target field and enforce a fixed 4-player roster for
  // team games (reorderable, but no add/remove).
  const applyModeLayout = () => {
    targetField.hidden = !rulesetOf(mode).configurableTarget;
    yamsOptField.hidden = mode !== "yams";
    brutalOptField.hidden = mode !== "vengeance";
    syncRoster(useTeamBuilder()); // carry names over when the roster type flips
    const fc = fixedCount();
    if (useTeamBuilder()) {
      addBtn.style.display = "none"; // the team builder has its own add button
    } else if (fc) {
      while (players.length < fc) players.push({ id: uid(), name: "" });
      if (players.length > fc) players.length = fc;
      addBtn.style.display = "none";
    } else {
      addBtn.style.display = "";
    }
    mountRoster();
    updateTeamsHint();
  };

  const modeTabs = modal.querySelector("#modeTabs");
  const syncModeTabs = () =>
    modeTabs
      .querySelectorAll(".mode-tab")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  modeTabs.querySelectorAll(".mode-tab").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      syncModeTabs();
      applyUnit();
      applyModeLayout();
    }),
  );
  syncModeTabs();

  applyUnit();
  applyModeLayout(); // mounts the roster
  // Keep the teams preview in sync with name edits and reordering.
  rowsEl.addEventListener("input", updateTeamsHint);
  rowsEl.addEventListener("pointerup", () => setTimeout(updateTeamsHint, 0));
  modal.querySelector("#addPlayer").addEventListener("click", () => {
    if (useTeamBuilder()) {
      teams.push(makeTeam(teams));
      rosterDraw();
      const cards = rowsEl.querySelectorAll(".team-card");
      if (cards.length) cards[cards.length - 1].querySelector(".team-name").focus();
    } else {
      players.push({ id: uid(), name: "" });
      rosterDraw();
      rowsEl.querySelector(".player-row:last-child input").focus();
    }
  });

  yamsChanceToggle.addEventListener("click", () => {
    yamsChance = !yamsChance;
    yamsChanceToggle.classList.toggle("active", yamsChance);
    yamsChanceToggle.setAttribute("aria-pressed", String(yamsChance));
  });

  brutalToggle.addEventListener("click", () => {
    brutalMode = !brutalMode;
    brutalToggle.classList.toggle("active", brutalMode);
    brutalToggle.setAttribute("aria-pressed", String(brutalMode));
  });

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  modal.querySelector("#start").addEventListener("click", () => {
    const def = rulesetOf(mode);
    const now = Date.now();
    // Time's Up!: build the scoring entities from the team builder. Each team
    // keeps its named members (used for per-player stats).
    if (useTeamBuilder()) {
      const built = teams
        .map((t) => ({
          id: t.id,
          name: t.name.trim(),
          members: t.members
            .map((m) => ({ id: m.id, name: m.name.trim() }))
            .filter((m) => m.name),
        }))
        .filter((t) => t.name || t.members.length);
      if (built.length < 2) return toast("Ajoutez au moins 2 équipes");
      for (const t of built)
        if (!t.name) return toast("Donnez un nom à chaque équipe");
      const dupT = firstDuplicateName(built.map((t) => t.name));
      if (dupT) return toast(`L'équipe « ${dupT} » est en double`);
      const dupP = firstDuplicateName(
        built.flatMap((t) => t.members.map((m) => m.name)),
      );
      if (dupP) return toast(`« ${dupP} » est présent dans deux équipes`);
      const game = {
        id: uid(),
        name: gameNameFromDate(now),
        createdAt: now,
        target: def.target,
        mode,
        place,
        players: built,
        rounds: [],
      };
      if (opts.restartOf) game.restartOf = opts.restartOf;
      upsertGame(game);
      overlay.remove();
      return go("game", { id: game.id });
    }
    const valid = players.filter((p) => p.name.trim());
    if (def.teams) {
      if (valid.length !== 4)
        return toast("La Contrée se joue à exactement 4 joueurs");
    } else if (def.fixedPlayers) {
      if (valid.length !== def.fixedPlayers)
        return toast(`Le Bombu se joue à exactement ${def.fixedPlayers} joueurs`);
    } else if (valid.length < 2) {
      return toast("Ajoutez au moins 2 joueurs");
    }
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    let target = def.target;
    if (def.configurableTarget) {
      target = Number(targetInput.value) || 0;
      if (target <= 0) return toast("Indiquez un score cible valide");
    }
    const game = {
      id: uid(),
      name: gameNameFromDate(now),
      createdAt: now,
      target,
      mode,
      place,
      players: valid.map((p) => ({ id: p.id, name: p.name.trim() })),
      rounds: [],
    };
    if (mode === "yams" && yamsChance) game.yamsChance = true;
    if (mode === "vengeance" && brutalMode) game.brutalMode = true;
    if (opts.restartOf) game.restartOf = opts.restartOf;
    upsertGame(game);
    overlay.remove();
    go("game", { id: game.id });
  });

  root.appendChild(overlay);
}

