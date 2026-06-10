/* <app-stats-table> — the ranked stats table for one place/version/metric.
   Presentational: data in via the `.data` property
   ({ stats, metric, mode }); the parent handles filters, sorting and empties. */
import { esc } from "../util.js";
import { unitLabel } from "../rules.js";
import { rankLabels } from "../scoring.js";
import { metricText } from "../stats.js";

class AppStatsTable extends HTMLElement {
  set data(d) {
    this._d = d;
    this.render();
  }
  get data() {
    return this._d;
  }

  render() {
    const { stats, metric, mode, showGames } = this._d || {};
    if (!stats || !metric) return;
    const labels = rankLabels(stats, metric.tie);
    const rows = stats
      .map((s, i) => {
        const { place, label } = labels[i];
        const rc = `rank${place}`;
        return `<tr class="${place === 1 ? "winner-row" : ""}">
          <td class="rank-col"><span class="badge ${rc}">${label}</span></td>
          <td class="player-name">${esc(s.name)}</td>
          ${showGames ? `<td class="games-col">${s.games}</td>` : ""}
          <td class="total-cell"><span class="score-badge ${rc}">${metric.value(s)}</span></td>
        </tr>`;
      })
      .join("");
    this.innerHTML = `
      <div class="table-wrap">
        <table class="score stats-table">
          <thead><tr>
            <th class="rank-col">#</th>
            <th class="player-name">${unitLabel(mode)}</th>
            ${showGames ? `<th class="games-col">Parties</th>` : ""}
            <th>${metricText(metric.valueHead, mode)}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
}

customElements.define("app-stats-table", AppStatsTable);
