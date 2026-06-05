/* Game actions not tied to one screen: end a manual-end game and crown the
   current leader(s). */
import { confirmDialog } from "./ui.js";
import { getGame, upsertGame } from "./store.js";
import { standings, winner } from "./scoring.js";
import { celebrateIfNewWinner } from "./dialogs/celebrate.js";
import { go } from "./nav.js";

export async function endGamePrompt(game) {
  const lead = standings(game)[0];
  const ok = await confirmDialog({
    title: "Terminer la partie ?",
    body: `La partie sera close et la victoire attribuée au joueur en tête${lead ? ` (actuellement ${lead.name}, ${lead.total} pts)` : ""}.`,
    confirmLabel: "Terminer",
    cancelLabel: "Retour",
  });
  if (!ok) return;
  const g = getGame(game.id);
  const beforeWinnerId = (winner(g) || {}).id || null;
  g.ended = true;
  upsertGame(g);
  go("game", { id: game.id });
  celebrateIfNewWinner(beforeWinnerId, g);
}
