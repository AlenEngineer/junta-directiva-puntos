import { boardView } from "./board";
import { directory, history } from "./church";
import { desk } from "./desk";
import type { CatalogOffice } from "./generated/CatalogOffice";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { home } from "./home";
import { baseFromManual, baseFromSetup, invitations, setupEditor } from "./setup-editor";
import { api, fill, h, root } from "./ui";

const me = await api<Viewer>("/api/me");

/** Every page the hash can name. Inicio is personal, a desk is one charge, the rest is the church's shared area. */
type Route =
  | { page: "inicio" }
  | { page: "cargo"; charge: number; tab: "responsabilidades" | "historial" }
  | { page: "oficiales"; byPerson: boolean }
  | { page: "votos" }
  | { page: "junta" }
  | { page: "votar" }
  | { page: "invitar"; from: number };

function parse(hash: string): Route {
  const [path, arg, sub] = hash.replace(/^#\/?/, "").split("/");
  switch (path) {
    case "cargo":
      return { page: "cargo", charge: Number(arg), tab: sub === "historial" ? "historial" : "responsabilidades" };
    case "iglesia":
      return arg === "votos" ? { page: "votos" } : { page: "oficiales", byPerson: arg === "personas" };
    case "junta":
      return { page: "junta" };
    case "votar":
      return { page: "votar" };
    case "invitar":
      return { page: "invitar", from: Number(arg) };
    default:
      return { page: "inicio" };
  }
}

/** Which item of the main navigation a page belongs to. */
function area(route: Route): "inicio" | "junta" | "iglesia" | null {
  if (route.page === "inicio") return "inicio";
  if (route.page === "junta") return "junta";
  if (route.page === "cargo") return null;
  return "iglesia";
}

const icons = {
  inicio: "M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z",
  junta: "M5 4h14v16H5zM8 9h8M8 13h8M8 17h5",
  iglesia: "M12 3l8 5H4zM6 8v10M10 8v10M14 8v10M18 8v10M4 20h16",
} as const;

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase() || "?";
}

function shell(setup: Setup | null, route: Route, page: HTMLElement, wide = false) {
  const signOut = () => h("form", { method: "post", action: "/api/auth/logout" }, h("button", { class: "link" }, "Salir"));
  const here = area(route);
  const links = [
    setup && (["inicio", "#/", "Inicio", "Inicio"] as const),
    me.may.read_board && (["junta", "#/junta", "Junta", "Junta directiva"] as const),
    me.may.read_setup && (["iglesia", "#/iglesia", "Iglesia", "Iglesia"] as const),
  ].filter((l) => !!l);
  const officeName = (id: string) => setup?.catalog.offices.find((o) => o.id === id)?.name ?? id;
  const current = route.page === "cargo" ? route.charge : null;

  fill(
    root,
    h(
      "div",
      { class: "shell" },
      h(
        "header",
        { class: "side" },
        h("a", { href: "#/", class: "brand" }, setup?.church ?? "Mayordomo"),
        h(
          "details",
          { class: "account" },
          h("summary", { "aria-label": `Cuenta de ${me.name}` }, initials(me.name)),
          h("div", { class: "menu" }, h("p", null, h("strong", null, me.name)), h("p", { class: "muted small" }, me.email), signOut()),
        ),
        links.length > 1 &&
          h(
            "nav",
            { class: "main", "aria-label": "Principal" },
            ...links.map(([key, href, short, long]) => {
              const a = h("a", { href }, icon(icons[key]), h("span", { class: "short" }, short), h("span", { class: "long" }, long));
              if (key === here) a.setAttribute("aria-current", "page");
              return a;
            }),
          ),
        me.charges.length > 0 &&
          h(
            "section",
            { class: "mine", "aria-label": "Mis cargos" },
            h("p", { class: "label" }, "Mis cargos"),
            ...me.charges.map((c) => {
              const a = h("a", { href: `#/cargo/${c.id}` }, officeName(c.office));
              if (c.id === current) a.setAttribute("aria-current", "page");
              return a;
            }),
          ),
        h("div", { class: "who" }, h("p", null, me.name), signOut()),
      ),
      h("main", { class: wide ? "wide" : "" }, page),
    ),
  );
}

async function route() {
  if (me.may.start_setup) {
    const manual = await api<{ offices: CatalogOffice[] }>("/api/setup/initial");
    shell(null, { page: "votar" }, setupEditor(baseFromManual(manual.offices), (from) => afterSave(from)), true);
    return;
  }
  const setup = me.may.read_setup ? await api<Setup>("/api/setup") : null;
  const r = parse(location.hash);
  let page: HTMLElement;
  let wide = false;
  if (setup && r.page === "oficiales") {
    page = directory(me, setup, r.byPerson);
    wide = true;
  } else if (setup && r.page === "votos") page = await history(me, setup);
  else if (r.page === "junta" && me.may.read_board) page = await boardView(me, route);
  else if (setup && r.page === "votar" && me.may.record_votes) {
    page = setupEditor(baseFromSetup(setup), (from) => afterSave(from));
    wide = true;
  } else if (setup && r.page === "invitar" && me.may.record_votes)
    page = await invitations(setup, r.from, me.email, () => location.assign("#/iglesia"));
  else if (setup && r.page === "cargo" && me.charges.some((c) => c.id === r.charge)) page = await desk(setup, me.charges.find((c) => c.id === r.charge)!, r.tab);
  else page = await home(me, setup, route);
  shell(setup, r, page, wide);
}

/** After a save, what the viewer may do can change (the first setup ends the developer's start), so reload. */
function afterSave(firstNewCharge: number) {
  location.hash = `#/invitar/${firstNewCharge}`;
  location.reload();
}

window.addEventListener("hashchange", () => void route().then(() => window.scrollTo(0, 0)));
await route();
