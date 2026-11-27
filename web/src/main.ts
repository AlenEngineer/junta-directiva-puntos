import { boardView } from "./board";
import { directory, history } from "./church";
import type { CatalogOffice } from "./generated/CatalogOffice";
import type { Charge } from "./generated/Charge";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { baseFromManual, baseFromSetup, invitations, setupEditor } from "./setup-editor";
import { api, fill, h, root } from "./ui";

const me = await api<Viewer>("/api/me");

function shell(setup: Setup | null, page: HTMLElement) {
  const signOut = h("form", { method: "post", action: "/api/auth/logout" }, h("button", { class: "link" }, "Salir"));
  const here = location.hash || "#/";
  const link = (href: string, label: string) =>
    h("a", { href, class: here === href || (href !== "#/" && here.startsWith(href)) ? "active" : "" }, label);
  fill(
    root,
    h(
      "header",
      { class: "top" },
      h("a", { href: "#/", class: "brand" }, setup?.church ?? "Mayordomo"),
      h(
        "nav",
        null,
        setup && link("#/", "Inicio"),
        me.may.read_setup && link("#/iglesia", "Oficiales"),
        me.may.record_votes && link("#/votar", "Registrar voto"),
      ),
      h("span", { class: "who" }, h("span", { class: "muted" }, me.email), signOut),
    ),
    h("main", null, page),
  );
}

function chargeView(setup: Setup | null, charge: Charge): HTMLElement {
  const office = setup?.catalog.offices.find((o) => o.id === charge.office);
  return h(
    "article",
    { class: "panel" },
    h("h3", null, office?.name ?? charge.office, " ", h("span", { class: "muted" }, `desde ${charge.term.start_year}`)),
    h("ul", null, ...charge.responsibilities.map((r) => h("li", null, r.page ? `${r.summary} (p. ${r.page})` : r.summary))),
  );
}

async function home(setup: Setup | null): Promise<HTMLElement> {
  return h(
    "div",
    { class: "stack" },
    h("header", { class: "intro" }, h("h1", null, `Hola, ${me.name.split(" ")[0]}`)),
    me.charges.length > 0
      ? h("section", { class: "stack" }, h("h2", null, me.charges.length === 1 ? "Tu cargo" : "Tus cargos"), ...me.charges.map((c) => chargeView(setup, c)))
      : h("p", { class: "muted" }, "No tienes un cargo vigente en esta iglesia."),
    me.may.read_board && (await boardView(me, route)),
  );
}

async function route() {
  if (me.may.start_setup) {
    const manual = await api<{ offices: CatalogOffice[] }>("/api/setup/initial");
    shell(null, setupEditor(baseFromManual(manual.offices), (from) => afterSave(from)));
    return;
  }
  const setup = me.may.read_setup ? await api<Setup>("/api/setup") : null;
  const [path, arg] = location.hash.replace(/^#\/?/, "").split("/");
  let page: HTMLElement;
  if (setup && path === "iglesia") page = directory(me, setup, arg === "personas");
  else if (setup && path === "historial") page = await history(setup);
  else if (setup && path === "votar" && me.may.record_votes) page = setupEditor(baseFromSetup(setup), (from) => afterSave(from));
  else if (setup && path === "invitar" && me.may.record_votes) page = invitations(setup, Number(arg), me.email, () => location.assign("#/iglesia"));
  else page = await home(setup);
  shell(setup, page);
}

/** After a save, what the viewer may do can change (the first setup ends the developer's start), so reload. */
function afterSave(firstNewCharge: number) {
  location.hash = `#/invitar/${firstNewCharge}`;
  location.reload();
}

window.addEventListener("hashchange", () => void route());
await route();
