/* Contrée game-screen UI: the teams scoreboard, the current-bid card, the
   action bar, and the dealer/bid/score dialogs (with automatic deal scoring). */
import { el, esc, toast } from "../util.js";
import { getGame, upsertGame } from "../store.js";
import { CONTREE_SUITS } from "../rules.js";
import {
  standings,
  winner,
  winners,
  teamsOf,
  currentDealer,
  rankLabels,
  contreeBidHTML,
} from "../scoring.js";
import { celebrateIfNewWinner } from "./celebrate.js";
import { go } from "../nav.js";

function buildContreeSummary(game) {
  const st = standings(game); // the two teams, sorted by total (desc)
  const winIds = new Set(winners(game).map((t) => t.id));
  const hasRounds = game.rounds.length > 0;
  const labels = rankLabels(st, (a, b) => a.total === b.total);
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(
    `<table class="score summary-table"><thead><tr><th class="rank-col">#</th><th class="player-name">Équipe</th><th>Total</th></tr></thead></table>`,
  );
  const tbody = el(`<tbody></tbody>`);
  st.forEach((t, i) => {
    const { place, label } = labels[i];
    const won = winIds.has(t.id);
    const crown = won
      ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    const rankBadge = hasRounds ? `<span class="badge rank${place}">${label}</span>` : "";
    tbody.appendChild(
      el(`
      <tr class="${won ? "winner-row" : ""}">
        <td class="rank-col">${rankBadge}</td>
        <td class="player-name">${esc(t.name)}</td>
        <td class="total-cell"><span class="score-badge rank${place}">${t.total}${crown}</span></td>
      </tr>`),
    );
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// Inline HTML describing a bid: contract value, trump suit icon, taking team,
// and a Contré/Surcontré tag when applicable.

// White card above the scoreboard: the dealer on the left and, once a bid has
// been entered, the bid info opposed on the right.
function buildBidInfo(game) {
  const dealer = currentDealer(game);
  const bid = game.pendingBid
    ? `<span class="bid-current">${contreeBidHTML(game.pendingBid, game)}</span>`
    : "";
  return el(`
    <div class="bid-info">
      <span class="bid-dealer"><i class="fa-regular fa-share-from-square"></i> Distribue : <b>${esc(dealer ? dealer.name : "")}</b></span>
      ${bid}
    </div>`);
}

// Action area for a Contrée game: pick the first dealer, then the
// dealer→bid→scores cycle. Shows the current deal's dealer.
function buildContreeBar(game) {
  const wrap = el(`<div class="contree-actions"></div>`);
  if (!game.dealer) {
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="setDealer"><i class="fa-regular fa-flag"></i> Qui distribue ?</button></div>`,
    );
    bar.querySelector("#setDealer").addEventListener("click", () => openDealerDialog(game));
    wrap.appendChild(bar);
    return wrap;
  }
  if (game.pendingBid) {
    // dealer is shown in the bid card above — just the action buttons here
    const bar = el(`
      <div class="new-scores-bar turn-bar">
        <button class="btn btn-primary btn-big" id="enterScores"><i class="fa-regular fa-plus"></i> Saisir les scores</button>
        <button class="btn btn-ghost btn-big btn-end" id="editBid"><i class="fa-regular fa-pen"></i> Mise</button>
      </div>`);
    bar.querySelector("#enterScores").addEventListener("click", () => openContreeScoreDialog(game));
    bar.querySelector("#editBid").addEventListener("click", () => openBidDialog(game));
    wrap.appendChild(bar);
  } else {
    // dealer is shown in the card above — just the "saisir la mise" button here
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="setBid"><i class="fa-regular fa-gavel"></i> Saisir la mise</button></div>`,
    );
    bar.querySelector("#setBid").addEventListener("click", () => openBidDialog(game));
    wrap.appendChild(bar);
  }
  return wrap;
}

// Pick who deals first; the deal then rotates in roster order.
function openDealerDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Qui distribue ?</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <p class="rules-intro">Choisissez le premier distributeur. La distribution tournera ensuite dans l'ordre des joueurs.</p>
      <div class="starter-list" id="dealerList"></div>
    </div>`;
  const list = modal.querySelector("#dealerList");
  game.players.forEach((p) => {
    const btn = el(`<button class="btn btn-ghost starter-item">${esc(p.name)}</button>`);
    btn.addEventListener("click", () => {
      const g = getGame(game.id);
      g.dealer = p.id;
      upsertGame(g);
      overlay.remove();
      go("game", { id: game.id });
    });
    list.appendChild(btn);
  });
  modal.querySelector("[data-act=close]").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}

// Enter (or edit) the current deal's bid: contract value, trump suit, taking
// team, and Contré/Surcontré. Stored on game.pendingBid until scores are saved.
function openBidDialog(game) {
  const saved = game.pendingBid || {};
  let contract = saved.contract || null;
  let suit = saved.suit || null;
  let team = saved.team || null;
  let coinche = saved.coinche || "none";
  const CONTRACTS = [80, 90, 100, 110, 120, 130, 140, 150, 160, "capot"];
  const contractLabel = (v) => (v === "capot" ? "Capot" : v);
  const teams = teamsOf(game);
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>${saved.contract ? "Modifier la mise" : "Saisir la mise"}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Contrat</label>
        <div class="pick-row contract-picker" id="contractPicker">
          ${CONTRACTS.map((v) => `<button type="button" class="pick-btn${contract === v ? " active" : ""}${v === "capot" ? " capot" : ""}" data-contract="${v}">${contractLabel(v)}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Atout</label>
        <div class="suit-picker" id="suitPicker">
          ${CONTREE_SUITS.map(
            (s) =>
              `<button type="button" class="suit-btn${s.red ? " red" : ""}${suit === s.key ? " active" : ""}" data-suit="${s.key}"><span class="suit-sym">${s.sym}</span> ${s.label}</button>`,
          ).join("")}
        </div>
      </div>
      <div class="field">
        <label>Équipe qui prend</label>
        <div class="pick-row" id="teamPicker">
          ${teams.map((t) => `<button type="button" class="pick-btn${team === t.id ? " active" : ""}" data-team="${t.id}">${esc(t.name)}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Contre</label>
        <div class="pick-row" id="coinchePicker">
          <button type="button" class="pick-btn${coinche === "none" ? " active" : ""}" data-coinche="none">Aucune</button>
          <button type="button" class="pick-btn${coinche === "coinche" ? " active" : ""}" data-coinche="coinche">Contré</button>
          <button type="button" class="pick-btn${coinche === "surcoinche" ? " active" : ""}" data-coinche="surcoinche">Surcontré</button>
        </div>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveBid">Valider la mise</button>
    </div>`;
  const sync = (sel, attr, val) =>
    modal
      .querySelectorAll(sel + " button")
      .forEach((b) => b.classList.toggle("active", b.dataset[attr] === val));
  modal.querySelectorAll("#contractPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.contract;
      contract = v === "capot" ? "capot" : Number(v);
      sync("#contractPicker", "contract", String(contract));
    }),
  );
  modal.querySelectorAll("#suitPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      suit = b.dataset.suit;
      sync("#suitPicker", "suit", suit);
    }),
  );
  modal.querySelectorAll("#teamPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      team = b.dataset.team;
      sync("#teamPicker", "team", team);
    }),
  );
  modal.querySelectorAll("#coinchePicker button").forEach((b) =>
    b.addEventListener("click", () => {
      coinche = b.dataset.coinche;
      sync("#coinchePicker", "coinche", coinche);
    }),
  );
  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector("#saveBid").addEventListener("click", () => {
    if (!contract) return toast("Choisissez la valeur du contrat");
    if (!suit) return toast("Choisissez l'atout");
    if (!team) return toast("Choisissez l'équipe qui prend");
    const g = getGame(game.id);
    g.pendingBid = { contract, suit, team, coinche };
    upsertGame(g);
    close();
    go("game", { id: game.id });
  });
  root.appendChild(overlay);
}

// Enter the two teams' scores for the current deal. The two trick scores are
// linked (they sum to 162); each team has a "Belote (+20)" toggle, and a live
// message flags whether the taking team made its contract. Commits a deal (bid
// + final scores), clears the pending bid, and advances the dealer.
function openContreeScoreDialog(game) {
  const teams = teamsOf(game);
  const bid = game.pendingBid;
  const TOTAL = 160; // trick points shared per deal (rounded base)
  const state = {};
  teams.forEach((t) => (state[t.id] = { belote: false }));
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de la donne</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      ${bid ? `<div class="deal-bid">${contreeBidHTML(bid, game)}</div>` : ""}
      <div class="entry-grid">
        ${teams
          .map(
            (t) => `
          <div class="entry-player">
            <span class="pname">${esc(t.name)}</span>
            <div class="entry-controls">
              <input type="number" inputmode="numeric" class="cell-input" data-score="${t.id}" placeholder="0" />
              <button type="button" class="btn btn-ghost btn-sm belote-btn" data-belote="${t.id}">Belote (+20)</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="contract-msg" id="contractMsg" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveDeal">Enregistrer la donne</button>
    </div>`;
  const inputs = {};
  teams.forEach((t) => (inputs[t.id] = modal.querySelector(`[data-score="${t.id}"]`)));
  const otherId = (id) => teams.find((t) => t.id !== id).id;
  const round10 = (n) =>
    Math.min(TOTAL, Math.max(0, Math.round((Number(n) || 0) / 10) * 10));
  const beloteOf = (id) => (state[id].belote ? 20 : 0);
  // Compute each team's deal score from the bid, the taker's (rounded) trick
  // points, the coinche and each team's belote.
  const compute = () => {
    if (!bid) return null;
    const takerId = bid.team;
    const defId = otherId(takerId);
    const tricks = round10(inputs[takerId].value); // taker's trick points
    const m =
      bid.coinche === "surcoinche" ? 4 : bid.coinche === "coinche" ? 2 : 1;
    let baseTaker = 0;
    let baseDef = 0;
    let success;
    if (bid.contract === "capot") {
      success = tricks >= TOTAL; // all tricks taken
      baseTaker = success ? 500 : 0;
      baseDef = success ? 0 : 500;
    } else {
      const c = Number(bid.contract) || 0;
      success = tricks + beloteOf(takerId) >= c; // belote counts toward contract
      if (bid.coinche !== "none") {
        const pot = (TOTAL + c) * m;
        baseTaker = success ? pot : 0;
        baseDef = success ? 0 : pot;
      } else if (tricks >= TOTAL) {
        baseTaker = 250 + c; // capot non annoncé
        success = true;
      } else if (success) {
        baseTaker = tricks + c;
        baseDef = TOTAL - tricks;
      } else {
        baseDef = TOTAL + c;
      }
    }
    // Belote always adds 20 to its team (kept even on a chute).
    return {
      success,
      scores: {
        [takerId]: baseTaker + beloteOf(takerId),
        [defId]: baseDef + beloteOf(defId),
      },
    };
  };
  const msg = modal.querySelector("#contractMsg");
  const refreshMsg = () => {
    const anyFilled = teams.some((t) => inputs[t.id].value !== "");
    const res = compute();
    if (!res || !anyFilled) return (msg.hidden = true);
    const taker = teams.find((t) => t.id === bid.team);
    const detail = teams
      .map((t) => `${esc(t.name)} <b>${res.scores[t.id]}</b>`)
      .join(" · ");
    msg.hidden = false;
    msg.classList.toggle("fail", !res.success);
    msg.innerHTML = `${esc(taker.name)} ${res.success ? "réalise son contrat" : "chute"} — ${detail}`;
  };
  // The two trick scores are complementary (sum to 160).
  teams.forEach((t) => {
    inputs[t.id].addEventListener("input", () => {
      const raw = inputs[t.id].value;
      inputs[otherId(t.id)].value = raw === "" ? "" : TOTAL - (Number(raw) || 0);
      refreshMsg();
    });
    // Snap to a multiple of 10 on blur.
    inputs[t.id].addEventListener("blur", () => {
      if (inputs[t.id].value === "") return;
      const r = round10(inputs[t.id].value);
      inputs[t.id].value = r;
      inputs[otherId(t.id)].value = TOTAL - r;
      refreshMsg();
    });
  });
  modal.querySelectorAll("[data-belote]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.belote;
      state[id].belote = !state[id].belote;
      b.classList.toggle("active", state[id].belote);
      refreshMsg();
    }),
  );
  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector("#saveDeal").addEventListener("click", () => {
    const res = compute();
    const scores = res ? res.scores : {};
    teams.forEach((t) => {
      if (scores[t.id] == null) scores[t.id] = round10(inputs[t.id].value);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ bid: g.pendingBid || null, scores, at: Date.now() });
    g.pendingBid = null; // deal committed — dealer advances automatically
    upsertGame(g);
    close();
    toast(`Donne ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });
  root.appendChild(overlay);
  inputs[bid ? bid.team : teams[0].id].focus();
}

// Details for a Contrée game: one row per deal (bid + each team's points).

/* ---------- Edit Players ---------- */
// Edit a game's roster and type in a dialog.
/* ---------- Entry (screen 2) ---------- */

export { buildContreeSummary, buildBidInfo, buildContreeBar };
