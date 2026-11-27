/**
 * A desk: one charge's own page. Its Plan holds the work that charge alone
 * allows, and its history belongs to the office, so a new holder reads what
 * the votes decided before them.
 */

import { entryRow, stampLines } from "./church";
import type { Charge } from "./generated/Charge";
import type { Desk } from "./generated/Desk";
import type { Entry } from "./generated/Entry";
import type { May } from "./generated/May";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { andList, api, button, churchYearSpan, dayDate, h, notify, stamp } from "./ui";

export type DeskTab = "plan" | "responsabilidades" | "historial";

/** `needs` is what waits on the person, shown first on every screen size. */
type Plan = { needs: HTMLElement[]; main: HTMLElement[]; aside: HTMLElement[] };

/**
 * The work a desk's Plan shows, one entry per permission a charge can carry.
 * A desk whose charge carries none of them has no Plan tab.
 */
const plans: { carries: (may: May) => boolean; build: (me: Viewer, setup: Setup, entries: Entry[]) => Plan }[] = [
  { carries: (may) => may.record_votes, build: votesPlan },
];

/** Whether the desk has a Plan, so the route can open it by default. */
export function hasPlan(desk: Desk): boolean {
  return plans.some((p) => p.carries(desk.may));
}

export async function deskView(me: Viewer, setup: Setup, desk: Desk, tab: DeskTab): Promise<HTMLElement> {
  const charge = desk.charge;
  const office = setup.catalog.offices.find((o) => o.id === charge.office);
  const name = office?.name ?? charge.office;
  const years = charge.term.length === "two_years" ? "dos años" : "un año";
  const base = `#/cargo/${charge.id}`;
  const own = plans.filter((p) => p.carries(desk.may));
  const tabLink = (key: DeskTab, label: string) => {
    const a = h("a", { href: `${base}/${key}` }, label);
    if (key === tab) a.setAttribute("aria-current", "page");
    return a;
  };

  let body: HTMLElement;
  if (tab === "plan" && own.length > 0) {
    const entries = await api<Entry[]>("/api/setup/history");
    const built = own.map((p) => p.build(me, setup, entries));
    const needs = built.flatMap((b) => b.needs);
    body = h(
      "div",
      { class: "desk-grid" },
      h(
        "div",
        { class: "stack" },
        needs.length > 0 && h("section", { class: "needs" }, h("h2", { class: "label" }, "Para hacer"), h("ul", { class: "rows" }, ...needs)),
        ...built.flatMap((b) => b.main),
      ),
      h("aside", { class: "stack" }, ...built.flatMap((b) => b.aside)),
    );
  } else if (tab === "historial") {
    const entries = await api<Entry[]>("/api/setup/history");
    const mine = entries.filter((e) => touches(setup, e, charge)).reverse();
    body =
      mine.length > 0
        ? h("div", null, ...mine.map((e) => entryRow(setup, e, charge.office)))
        : h("p", { class: "muted" }, "Ningún voto registrado toca este oficio todavía.");
  } else {
    body =
      charge.responsibilities.length > 0
        ? h(
            "ul",
            { class: "rows" },
            ...charge.responsibilities.map((r) => h("li", null, h("span", { class: "grow" }, r.summary), r.page !== null && h("span", { class: "page" }, `p. ${r.page}`))),
          )
        : h("p", { class: "muted" }, "Las responsabilidades de este oficio todavía no están escritas en Mayordomo.");
  }

  return h(
    "div",
    { class: "stack" },
    h(
      "header",
      { class: "intro" },
      h("a", { href: "#/", class: "back" }, "‹ Inicio"),
      h("h1", null, name),
      h("p", null, `Por ${years} desde el año eclesiástico ${charge.term.start_year} (${churchYearSpan(charge.term.start_year, setup.year_starts)})`),
    ),
    h(
      "nav",
      { class: "tabs", "aria-label": name },
      own.length > 0 && tabLink("plan", "Plan"),
      tabLink("responsabilidades", "Responsabilidades"),
      tabLink("historial", "Historial"),
    ),
    body,
  );
}

function touches(setup: Setup, e: Entry, charge: Charge): boolean {
  return (
    e.change.elect.some((c) => c.office === charge.office) ||
    e.change.release.some((id) => setup.charges.find((c) => c.id === id)?.office === charge.office) ||
    e.change.catalog.hide.includes(charge.office) ||
    e.change.catalog.restore.includes(charge.office) ||
    e.change.catalog.offices.some((o) => o.id === charge.office)
  );
}

/** "3 elegidos y 1 termina", what a vote did in a few words. */
function summary(e: Entry): string {
  const c = e.change;
  const offices = c.catalog.offices.length + c.catalog.hide.length + c.catalog.restore.length;
  const parts = [
    c.elect.length > 0 && (c.elect.length === 1 ? "1 elegido" : `${c.elect.length} elegidos`),
    c.release.length > 0 && (c.release.length === 1 ? "1 termina" : `${c.release.length} terminan`),
    offices > 0 && (offices === 1 ? "1 cambio de oficios" : `${offices} cambios de oficios`),
    (c.church !== null || c.year_starts !== null) && e.approval.kind === "vote" && "datos de la iglesia",
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? andList(parts) : "Sin cambios";
}

/** The clerk's work with the church's votes: record the next one, see the last ones, and get officers signed in. */
function votesPlan(me: Viewer, setup: Setup, entries: Entry[]): Plan {
  const recent = entries.slice(-3).reverse();
  const serving = setup.charges.filter((c) => setup.serving.includes(c.id));
  const officeName = (id: string) => setup.catalog.offices.find((o) => o.id === id)?.name ?? id;

  const without = serving.filter((c) => !c.holder.email);
  const byEmail = new Map<string, Charge[]>();
  for (const c of serving) if (c.holder.email && c.holder.email !== me.email) byEmail.set(c.holder.email, [...(byEmail.get(c.holder.email) ?? []), c]);
  const people = [...byEmail.values()].sort((a, b) => a[0]!.holder.name.localeCompare(b[0]!.holder.name, "es"));

  const inviteRow = (charges: Charge[]) => {
    const first = charges[0]!;
    const status = h("div", { class: "sub" }, andList(charges.map((c) => officeName(c.office))));
    const action = button("Invitar", async () => {
      await api(`/api/setup/charges/${first.id}/invitation`, "POST");
      notify(`Invitación enviada a ${first.holder.email}`);
      status.textContent = "Invitación enviada";
      action.remove();
    });
    return h("li", null, h("div", { class: "grow" }, first.holder.name, status), action);
  };
  const inviteList = h("ul", { class: "rows" }, ...people.map(inviteRow));

  const names = [...new Set(without.map((c) => c.holder.name))];
  return {
    needs:
      names.length > 0
        ? [
            h(
              "li",
              null,
              h(
                "div",
                { class: "grow" },
                h("strong", null, names.length === 1 ? "Un oficial sin correo" : `${names.length} oficiales sin correo`),
                h("div", { class: "sub" }, `${andList(without.map((c) => `${c.holder.name} (${officeName(c.office)})`))} ${names.length === 1 ? "no puede" : "no pueden"} entrar. El correo se anota con un voto que lo elija de nuevo.`),
              ),
            ),
          ]
        : [],
    main: [
      h(
        "section",
        { class: "stack tight" },
        h("h2", null, "Votos de la iglesia"),
        h("p", { class: "muted" }, "Cada elección de oficiales y cada cambio de oficios se registra con el voto de la iglesia que lo aprobó."),
        h("p", null, h("a", { href: "#/votar", class: "button primary" }, "Registrar un voto")),
      ),
      recent.length > 0 &&
        h(
          "section",
          null,
          h("h2", null, "Votos recientes"),
          h(
            "ul",
            { class: "rows" },
            ...recent.map((e) =>
              h(
                "li",
                null,
                h(
                  "div",
                  { class: "grow" },
                  e.approval.kind === "vote" ? `Voto de la iglesia del ${dayDate(e.approval.date).toLowerCase()}` : "Configuración inicial",
                  h("div", { class: "sub" }, summary(e)),
                ),
                stamp(stampLines(e.approval), { small: true }),
              ),
            ),
          ),
          h("p", { class: "more" }, h("a", { href: "#/iglesia/votos" }, "Ver todos los votos")),
        ),
    ].filter((n): n is HTMLElement => !!n),
    aside: [
      h(
        "section",
        { class: "sheet" },
        h("h2", null, "Oficiales"),
        h("p", { class: "muted small" }, `${serving.length} ${serving.length === 1 ? "cargo" : "cargos"} en el año eclesiástico ${setup.church_year}.`),
        people.length > 0 &&
          (people.length > 6
            ? h("details", { class: "unused" }, h("summary", null, `Invitar a un oficial (${people.length})`), inviteList)
            : h("div", null, h("h3", { class: "label" }, "Invitar a un oficial"), inviteList)),
      ),
    ],
  };
}
