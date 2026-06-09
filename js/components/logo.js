/* <app-logo> — the brand logo (the "Kigagne ?" wordmark, img/logo_color.svg).
   Light DOM so the global styles.css applies. The markup lives in logoMarkup()
   (util.js); its sizing is the .brand-logo rules in styles.css. */
import { logoMarkup } from "../util.js";

class AppLogo extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this.innerHTML = logoMarkup();
    this._rendered = true;
  }
}

customElements.define("app-logo", AppLogo);
