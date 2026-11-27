/** The church as it stands: who serves in what this church year, and the votes behind it. */

import type { Approval } from "./generated/Approval";
import type { Charge } from "./generated/Charge";
import type { Entry } from "./generated/Entry";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { andList, api, button, churchYearSpan, fold, h, longDate, monthName, notify, stamp } from "./ui";

/** Oficiales and Votos, the two pages of the church's shared area. */
function churchTabs(current: "oficiales" | "votos"): HTMLElement {
  const link = (key: typeof current, href: string, label: string) => {
    const a = h("a", { href }, label);
    if (key === current) a.setAttribute("aria-current", "page");
    return a;
  };
  return h("nav", { class: "tabs", "aria-label": "Iglesia" }, link("oficiales", "#/iglesia", "Oficiales"), link("votos", "#/iglesia/votos", "Votos"));
}

function intro(me: Viewer, setup: Setup): HTMLElement {
  return h(
    "header",
    { class: "intro" },
    h("h1", null, setup.church),
    h("p", null, `Año eclesiástico ${setup.church_year}: ${churchYearSpan(setup.church_year, setup.year_starts)}.`),
    me.may.record_votes && h("p", { class: "act" }, h("a", { href: "#/votar", class: "button primary" }, "Registrar un voto")),
  );
}

export function directory(me: Viewer, setup: Setup, byPerson: boolean): HTMLElement {
  const serving = setup.charges.filter((c) => setup.serving.includes(c.id));
  const officeName = (id: string) => setup.catalog.offices.find((o) => o.id === id)?.name ?? id;
  const invite = (c: Charge) =>
    me.may.record_votes &&
    c.holder.email &&
    c.holder.email !== me.email &&
    button("Invitar", async () => {
      await api(`/api/setup/charges/${c.id}/invitation`, "POST");
      notify(`Invitación enviada a ${c.holder.email}`);
    }, "link");
  const email = (c: Charge) => (c.holder.email ? h("span", { class: "muted small" }, c.holder.email) : h("span", { class: me.may.record_votes ? "warn small" : "muted small" }, "sin correo"));

  const filter = h("input", { type: "search", placeholder: byPerson ? "Buscar persona" : "Buscar oficio o persona", "aria-label": "Buscar" });
  const list = h("div", { class: "ledger" });

  if (byPerson) {
    const people = new Map<string, Charge[]>();
    for (const c of serving) {
      const key = c.holder.email ?? `nombre:${c.holder.name}`;
      people.set(key, [...(people.get(key) ?? []), c]);
    }
    const sorted = [...people.values()].sort((a, b) => a[0]!.holder.name.localeCompare(b[0]!.holder.name, "es"));
    list.append(
      ...sorted.map((charges) => {
        const first = charges[0]!;
        return h(
          "div",
          { class: "office" },
          h("header", null, h("h3", null, first.holder.name), email(first)),
          h("div", { class: "holders" }, h("div", { class: "holder" }, h("span", null, andList(charges.map((c) => officeName(c.office)))), invite(first))),
        );
      }),
    );
  } else {
    list.append(
      ...setup.catalog.offices.map((office) => {
        const holders = serving.filter((c) => c.office === office.id);
        return h(
          "div",
          { class: "office" },
          h("header", null, h("h3", null, office.name)),
          h(
            "div",
            { class: "holders" },
            ...(holders.length === 0
              ? [h("div", { class: "holder muted" }, "Vacante")]
              : holders.map((c) => h("div", { class: "holder" }, h("span", null, c.holder.name, " ", email(c)), invite(c)))),
          ),
        );
      }),
    );
  }
  filter.oninput = () => {
    const q = fold(filter.value);
    for (const item of list.children) (item as HTMLElement).hidden = q !== "" && !fold(item.textContent ?? "").includes(q);
  };
  const link = (active: boolean, href: string, label: string) => {
    const a = h("a", { href }, label);
    if (active) a.setAttribute("aria-current", "page");
    return a;
  };

  return h(
    "div",
    { class: "stack" },
    intro(me, setup),
    churchTabs("oficiales"),
    h(
      "div",
      { class: "toolbar" },
      h("nav", { class: "tabs bare", "aria-label": "Ordenar" }, link(!byPerson, "#/iglesia", "Por oficio"), link(byPerson, "#/iglesia/personas", "Por persona")),
      filter,
    ),
    list,
    h(
      "p",
      { class: "muted" },
      setup.catalog.hidden.length === 1
        ? "1 oficio del Manual no se usa en esta iglesia."
        : `${setup.catalog.hidden.length} oficios del Manual no se usan en esta iglesia.`,
    ),
  );
}

const bodyName = { church: "Voto de la iglesia", board: "Junta directiva" } as const;

/** What a stamp says: the body, the day and the minute. */
export function stampLines(approval: Approval): string[] {
  if (approval.kind === "initial") return ["Configuración inicial"];
  return [bodyName[approval.body], longDate(approval.date), approval.minute].filter((l): l is string => !!l);
}

/** One recorded vote: what it changed beside its stamp. With `office`, only the lines about that office. */
export function entryRow(setup: Setup, entry: Entry, office?: string): HTMLElement {
  const offices = [...setup.catalog.offices, ...setup.catalog.hidden];
  const officeName = (id: string) => offices.find((o) => o.id === id)?.name ?? id;
  const about = (id: string) => office === undefined || id === office;
  const c = entry.change;
  const released = c.release.map((id) => setup.charges.find((ch) => ch.id === id)).filter((ch): ch is Charge => !!ch && about(ch.office));
  const lines = [
    office === undefined && c.church !== null && `Nombre: ${c.church}`,
    office === undefined && c.year_starts !== null && `El año eclesiástico empieza en ${monthName(c.year_starts)}`,
    ...c.catalog.offices.filter((o) => about(o.id)).map((o) => `Oficio nuevo: ${o.name}`),
    ...c.catalog.hide.filter(about).map((id) => `Deja de usar: ${officeName(id)}`),
    ...c.catalog.restore.filter(about).map((id) => `Vuelve a usar: ${officeName(id)}`),
    office === undefined && c.catalog.board_agenda !== null && "Nueva agenda de la junta directiva",
    ...released.map((ch) => `Termina: ${ch.holder.name}${office === undefined ? `, ${officeName(ch.office)}` : ""}`),
    ...c.elect.filter((e) => about(e.office)).map((e) => `${officeName(e.office)}: ${e.holder.name} (desde ${e.term.start_year})`),
  ].filter((line): line is string => typeof line === "string");
  return h("article", { class: "entry" }, h("ul", null, ...lines.map((l) => h("li", null, l))), stamp(stampLines(entry.approval)));
}

export async function history(me: Viewer, setup: Setup): Promise<HTMLElement> {
  const entries = await api<Entry[]>("/api/setup/history");
  return h(
    "div",
    { class: "stack" },
    intro(me, setup),
    churchTabs("votos"),
    h("p", { class: "muted" }, "Cada cambio de los oficiales y los oficios, con el voto que lo aprobó."),
    h("div", null, ...entries.reverse().map((e) => entryRow(setup, e))),
  );
}
