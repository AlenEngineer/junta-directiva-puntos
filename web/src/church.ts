/** The church as it stands: who serves in what this church year, and the votes behind it. */

import type { Charge } from "./generated/Charge";
import type { Entry } from "./generated/Entry";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { api, button, churchYearSpan, h, monthName, notify, fold } from "./ui";

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

  const filter = h("input", { type: "search", placeholder: byPerson ? "Buscar persona" : "Buscar oficio o persona", class: "grow" });
  const list = h("ul", { class: "directory" });

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
          "li",
          null,
          h("div", null, h("strong", null, first.holder.name), " ", h("span", { class: "muted" }, first.holder.email ?? "sin correo"), " ", invite(first)),
          h("div", null, charges.map((c) => officeName(c.office)).join(" · ")),
        );
      }),
    );
  } else {
    list.append(
      ...setup.catalog.offices.map((office) => {
        const holders = serving.filter((c) => c.office === office.id);
        return h(
          "li",
          null,
          h("div", null, h("strong", null, office.name)),
          holders.length === 0
            ? h("div", { class: "muted" }, "Vacante")
            : h(
                "div",
                null,
                ...holders.map((c) =>
                  h("div", null, c.holder.name, " ", h("span", { class: "muted" }, c.holder.email ?? "sin correo"), " ", invite(c)),
                ),
              ),
        );
      }),
    );
  }
  filter.oninput = () => {
    const q = fold(filter.value);
    for (const item of list.children) (item as HTMLElement).hidden = q !== "" && !fold(item.textContent ?? "").includes(q);
  };

  return h(
    "div",
    { class: "stack" },
    h(
      "header",
      { class: "intro" },
      h("h1", null, setup.church),
      h("p", null, `Año eclesiástico ${setup.church_year}: ${churchYearSpan(setup.church_year, setup.year_starts)}.`),
    ),
    h(
      "div",
      { class: "toolbar" },
      h(
        "nav",
        { class: "tabs" },
        h("a", { href: "#/iglesia", class: byPerson ? "" : "active" }, "Por oficio"),
        h("a", { href: "#/iglesia/personas", class: byPerson ? "active" : "" }, "Por persona"),
      ),
      filter,
    ),
    h("section", { class: "panel" }, list),
    h(
      "p",
      { class: "muted" },
      setup.catalog.hidden.length === 1
        ? "1 oficio del Manual no se usa en esta iglesia. "
        : `${setup.catalog.hidden.length} oficios del Manual no se usan en esta iglesia. `,
      h("a", { href: "#/historial" }, "Ver los votos registrados"),
    ),
  );
}

export async function history(setup: Setup): Promise<HTMLElement> {
  const entries = await api<Entry[]>("/api/setup/history");
  const offices = [...setup.catalog.offices, ...setup.catalog.hidden];
  const officeName = (id: string) => offices.find((o) => o.id === id)?.name ?? id;
  const body = { church: "La iglesia", board: "Junta directiva" } as const;
  return h(
    "div",
    { class: "stack" },
    h("header", { class: "intro" }, h("h1", null, "Votos registrados"), h("p", null, "Cada cambio de la configuración, con el voto que lo aprobó.")),
    ...entries.reverse().map((entry) => {
      const c = entry.change;
      const lines = [
        c.church !== null && `Nombre: ${c.church}`,
        c.year_starts !== null && `El año eclesiástico empieza en ${monthName(c.year_starts)}`,
        ...c.catalog.offices.map((o) => `Oficio nuevo: ${o.name}`),
        ...c.catalog.hide.map((id) => `Deja de usar: ${officeName(id)}`),
        ...c.catalog.restore.map((id) => `Vuelve a usar: ${officeName(id)}`),
        c.catalog.board_agenda !== null && "Nueva agenda de la junta directiva",
        c.release.length > 0 && `Terminan ${c.release.length} ${c.release.length === 1 ? "cargo" : "cargos"}`,
        ...c.elect.map((e) => `${officeName(e.office)}: ${e.holder.name} (desde ${e.term.start_year})`),
      ].filter((line): line is string => typeof line === "string");
      const approval =
        entry.approval.kind === "initial"
          ? "Configuración inicial"
          : [body[entry.approval.body], entry.approval.date, entry.approval.minute].filter(Boolean).join(" · ");
      return h("article", { class: "panel" }, h("h3", null, approval), h("ul", null, ...lines.map((l) => h("li", null, l))));
    }),
  );
}
