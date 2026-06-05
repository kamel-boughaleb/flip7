/* <app-logo> — the brand logo (currently the FLIP7 fan card).
   Light DOM so the global styles.css applies. When the new logo arrives, this
   is the single place to change (markup here + its CSS). */
import { logoMarkup } from "../util.js";

class AppLogo extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this.innerHTML = logoMarkup();
    this._rendered = true;
  }
}

customElements.define("app-logo", AppLogo);
