/**
 * A desk: one charge's own page. Its history belongs to the office, so a new
 * holder reads what the votes decided before them.
 */

import type { Charge } from "./generated/Charge";
import type { Entry } from "./generated/Entry";
import type { Setup } from "./generated/Setup";
import { entryRow } from "./church";
import { api, churchYearSpan, h } from "./ui";

export async function desk(setup: Setup, charge: Charge, tab: "responsabilidades" | "historial"): Promise<HTMLElement> {
  const office = setup.catalog.offices.find((o) => o.id === charge.office);
  const name = office?.name ?? charge.office;
  const years = charge.term.length === "two_years" ? "dos años" : "un año";
  const base = `#/cargo/${charge.id}`;
  const tabLink = (key: typeof tab, href: string, label: string) => {
    const a = h("a", { href }, label);
    if (key === tab) a.setAttribute("aria-current", "page");
    return a;
  };

  let body: HTMLElement;
  if (tab === "historial") {
    const entries = await api<Entry[]>("/api/setup/history");
    const touches = (e: Entry) =>
      e.change.elect.some((c) => c.office === charge.office) ||
      e.change.release.some((id) => setup.charges.find((c) => c.id === id)?.office === charge.office) ||
      e.change.catalog.hide.includes(charge.office) ||
      e.change.catalog.restore.includes(charge.office) ||
      e.change.catalog.offices.some((o) => o.id === charge.office);
    const mine = entries.filter(touches).reverse();
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
      tabLink("responsabilidades", base, "Responsabilidades"),
      tabLink("historial", `${base}/historial`, "Historial"),
    ),
    body,
  );
}
