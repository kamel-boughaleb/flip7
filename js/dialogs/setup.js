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
  let yamsChance = false; // Yam's-only option: add the optional Chance case

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
        <input type="number" inputmode="numeric" class="cell-input target-input" id="targetInput" placeholder="2000" value="2000" />
      </div>
      <div class="field" id="yamsOptField" hidden>
        <label>Options</label>
        <button type="button" class="setup-opt" id="yamsChanceToggle" aria-pressed="false">
          <span class="setup-opt-main">
            <span class="setup-opt-name">Chance</span>
            <span class="setup-opt-desc muted">Ajoute une 13ᵉ case : la somme des 5 dés.</span>
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
  const teamsHint = modal.querySelector("#teamsHint");
  const isTeams = () => rulesetOf(mode).teams;
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
    if (isTeams()) {
      while (players.length < 4) players.push({ id: uid(), name: "" });
      if (players.length > 4) players.length = 4;
      addBtn.style.display = "none";
    } else {
      addBtn.style.display = "";
    }
    drawRows();
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

  const drawRows = renderPlayerRows(rowsEl, players, {
    allowRemove: () => !isTeams(),
    placeholder: () => unitOf(mode).placeholder,
    suggestions: () => placePlayerNames(place, unitKeyOf(mode)),
  });
  applyUnit();
  applyModeLayout();
  // Keep the teams preview in sync with name edits and reordering.
  rowsEl.addEventListener("input", updateTeamsHint);
  rowsEl.addEventListener("pointerup", () => setTimeout(updateTeamsHint, 0));
  modal.querySelector("#addPlayer").addEventListener("click", () => {
    players.push({ id: uid(), name: "" });
    drawRows();
    rowsEl.querySelector(".player-row:last-child input").focus();
  });

  yamsChanceToggle.addEventListener("click", () => {
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

  modal.querySelector("#start").addEventListener("click", () => {
    const def = rulesetOf(mode);
    const valid = players.filter((p) => p.name.trim());
    if (def.teams) {
      if (valid.length !== 4)
        return toast("La Contrée se joue à exactement 4 joueurs");
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
    const now = Date.now();
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
    upsertGame(game);
    overlay.remove();
    go("game", { id: game.id });
  });

  root.appendChild(overlay);
}

