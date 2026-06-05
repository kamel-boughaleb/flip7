/* ---------- ui ----------
   Generic promise-based dialogs, reusable by screens and components.
   Depend only on util (el/esc) + the #modal-root element. */
import { el, esc } from "./util.js";

function confirmDialog({
  title,
  body,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <p>${esc(body)}</p>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(false);
      if (act === "ok") close(true);
    });
    root.appendChild(overlay);
  });
}

function promptDialog({
  title,
  label,
  placeholder = "",
  confirmLabel = "Ajouter",
}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <div class="field">
            <label>${esc(label)}</label>
            <input type="text" id="promptInput" placeholder="${esc(placeholder)}" />
          </div>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">Annuler</button>
            <button class="btn btn-primary" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const input = overlay.querySelector("#promptInput");
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    const submit = () => close(input.value.trim() || null);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(null);
      if (act === "ok") submit();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    root.appendChild(overlay);
    setTimeout(() => input.focus(), 30);
  });
}

export { confirmDialog, promptDialog };
