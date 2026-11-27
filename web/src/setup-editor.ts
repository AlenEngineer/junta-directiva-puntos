/**
 * Entering the church's setup: the first one, which the developer enters
 * with no vote, and every later vote of the church, which the clerk or
 * the first elder records.
 *
 * The clerk usually reads from the nominating committee's report, which
 * lists offices, so the editor goes office by office. The review regroups
 * what changes by person, the way the people elected will see it, and
 * invitations go out per person after saving.
 */

import type { CatalogOffice } from "./generated/CatalogOffice";
import type { Change } from "./generated/Change";
import type { Charge } from "./generated/Charge";
import type { NewCharge } from "./generated/NewCharge";
import type { NewEntry } from "./generated/NewEntry";
import type { Setup } from "./generated/Setup";
import { stampLines } from "./church";
import type { Entry } from "./generated/Entry";
import { MONTHS, andList, api, button, churchYearSpan, fill, h, monthName, notify, saved, fold, stamp } from "./ui";

/** What the editor starts from: the church as it stands, or the bare manual for a first setup. */
export type Base = {
  first: boolean;
  church: string;
  year_starts: number;
  latest: number;
  offices: CatalogOffice[];
  hidden: CatalogOffice[];
  charges: Charge[];
  serving: number[];
  church_year: number | null;
};

export function baseFromSetup(setup: Setup): Base {
  return {
    first: false,
    church: setup.church,
    year_starts: setup.year_starts,
    latest: setup.latest,
    offices: setup.catalog.offices,
    hidden: setup.catalog.hidden,
    charges: setup.charges,
    serving: setup.serving,
    church_year: setup.church_year,
  };
}

export function baseFromManual(offices: CatalogOffice[]): Base {
  return { first: true, church: "", year_starts: 1, latest: 0, offices, hidden: [], charges: [], serving: [], church_year: null };
}

/** Someone the vote elects to an office. An empty name is a row not filled in. */
type Row = { key: number; office: string; name: string; email: string };

type NewOffice = { id: string; name: string; board_member: boolean };

type Draft = {
  /** The `latest` of the setup the draft was started against. */
  after: number;
  church: string;
  year_starts: number;
  hide: string[];
  restore: string[];
  release: number[];
  rows: Row[];
  added: NewOffice[];
  term_year: number;
  two_years: boolean;
  date: string;
  minute: string;
};

const DRAFT_KEY = "mayordomo:borrador";

/** The church year today falls in, for a first setup whose month is still being chosen. */
function yearFor(starts: number): number {
  const now = new Date();
  return now.getUTCMonth() + 1 >= starts ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function freshDraft(base: Base): Draft {
  return {
    after: base.latest,
    church: base.church,
    year_starts: base.year_starts,
    hide: [],
    restore: [],
    release: [],
    rows: [],
    added: [],
    term_year: base.church_year ?? yearFor(base.year_starts),
    two_years: false,
    date: "",
    minute: "",
  };
}

let nextKey = 1;

export function setupEditor(base: Base, onSaved: (firstNewCharge: number) => void): HTMLElement {
  const stored = saved.get<Draft>(DRAFT_KEY);
  const draft: Draft = stored && stored.after === base.latest ? stored : freshDraft(base);
  nextKey = Math.max(0, ...draft.rows.map((r) => r.key)) + 1;
  const keep = () => saved.set(DRAFT_KEY, draft);
  const page = h("div", { class: "stack" });

  const allOffices = (): CatalogOffice[] => [
    ...base.offices,
    ...base.hidden,
    ...draft.added.map((o) => ({ ...o, page: null, approved_by: null, variant_of: null, responsibilities: [], layer: draft.church })),
  ];
  const officeName = (id: string) => allOffices().find((o) => o.id === id)?.name ?? id;
  const isUsed = (id: string) =>
    draft.added.some((o) => o.id === id) ||
    (base.offices.some((o) => o.id === id) && !draft.hide.includes(id)) ||
    (base.hidden.some((o) => o.id === id) && draft.restore.includes(id));

  /** Everyone the editor knows by name, for suggesting a name and filling in its email. */
  const people = (): Map<string, string> => {
    const known = new Map<string, string>();
    for (const c of base.charges) known.set(c.holder.name, c.holder.email ?? known.get(c.holder.name) ?? "");
    for (const r of draft.rows) if (r.name.trim()) known.set(r.name.trim(), r.email.trim() || known.get(r.name.trim()) || "");
    return known;
  };
  const datalist = h("datalist", { id: "personas" });
  const refreshPeople = () => datalist.replaceChildren(...[...people().keys()].sort().map((name) => h("option", { value: name })));

  // ---- Editing ----

  function edit() {
    refreshPeople();
    const filter = h("input", { type: "search", placeholder: "Buscar oficio o persona", "aria-label": "Buscar" });
    const cards = h("div", { class: "ledger" });
    const used = allOffices().filter((o) => isUsed(o.id));
    const unused = allOffices().filter((o) => !isUsed(o.id));
    const cardFor = new Map<string, HTMLElement>();
    for (const office of used) {
      const card = officeCard(office);
      cardFor.set(office.id, card);
      cards.append(card);
    }
    filter.oninput = () => {
      const q = fold(filter.value);
      for (const [id, card] of cardFor) card.hidden = q !== "" && !fold(card.textContent + " " + rowsText(id)).includes(q);
    };

    fill(page,
      base.first
        ? h(
            "header",
            { class: "intro" },
            h("h1", null, "Configurar la iglesia"),
            h(
              "p",
              null,
              "Anota la iglesia y los oficiales que sirven hoy. Esta configuración inicial no necesita voto; los cambios posteriores se registran con el voto que los aprobó.",
            ),
          )
        : h(
            "header",
            { class: "intro" },
            h("h1", null, "Registrar un voto"),
            h("p", null, "Anota lo que votó la iglesia, oficio por oficio. Antes de guardar verás el resumen por persona."),
          ),
      churchPanel(),
      termPanel(),
      h("div", { class: "toolbar" }, filter),
      cards,
      newOfficePanel(),
      unused.length > 0 && unusedPanel(unused),
      h("div", { class: "actions sticky" }, button("Revisar cambios", async () => review(), "primary")),
      datalist,
    );
  }

  function rowsText(office: string): string {
    return draft.rows
      .filter((r) => r.office === office)
      .map((r) => `${r.name} ${r.email}`)
      .join(" ");
  }

  function churchPanel(): HTMLElement {
    const name = h("input", { value: draft.church, required: true, placeholder: "Iglesia Adventista de …", autocomplete: "off" });
    name.oninput = () => {
      draft.church = name.value;
      keep();
    };
    const month = h("select", null, ...MONTHS.map((m, i) => h("option", { value: String(i + 1), selected: i + 1 === draft.year_starts }, m)));
    month.onchange = () => {
      draft.year_starts = Number(month.value);
      if (base.first) draft.term_year = yearFor(draft.year_starts);
      keep();
      edit();
    };
    return h(
      "section",
      { class: "sheet" },
      h("div", { class: "form" }, h("label", null, "Nombre de la iglesia", name), h("label", null, "El año eclesiástico empieza en", month)),
    );
  }

  function termPanel(): HTMLElement {
    const current = base.church_year ?? yearFor(draft.year_starts);
    const year = h(
      "select",
      null,
      ...[current - 1, current, current + 1].map((y) =>
        h("option", { value: String(y), selected: y === draft.term_year }, `${y} (${churchYearSpan(y, draft.year_starts)})`),
      ),
    );
    year.onchange = () => {
      draft.term_year = Number(year.value);
      keep();
    };
    const length = h(
      "select",
      null,
      h("option", { value: "1", selected: !draft.two_years }, "un año"),
      h("option", { value: "2", selected: draft.two_years }, "dos años"),
    );
    length.onchange = () => {
      draft.two_years = length.value === "2";
      keep();
    };
    return h(
      "section",
      { class: "sheet" },
      h("div", { class: "form" }, h("label", null, "Los elegidos sirven desde el año eclesiástico", year), h("label", null, "Por un período de", length)),
      h("p", { class: "muted small" }, "Quien ya tiene el cargo sigue sirviendo hasta que empiece el período de su sucesor (Manual, pp. 91-92)."),
    );
  }

  function officeCard(office: CatalogOffice): HTMLElement {
    const card = h("article", { class: "office" });
    const redraw = () => {
      const fresh = officeCard(office);
      card.replaceWith(fresh);
      return fresh;
    };
    const holders = base.charges.filter((c) => c.office === office.id && base.serving.includes(c.id));
    const rows = draft.rows.filter((r) => r.office === office.id);
    if (rows.length === 0) {
      const blank = { key: nextKey++, office: office.id, name: "", email: "" };
      draft.rows.push(blank);
      rows.push(blank);
    }
    const isNew = draft.added.some((o) => o.id === office.id);
    const hideButton =
      isNew
        ? button("Quitar", async () => {
            draft.added = draft.added.filter((o) => o.id !== office.id);
            draft.rows = draft.rows.filter((r) => r.office !== office.id);
            keep();
            edit();
          }, "link")
        : button("No se usa", async () => {
            if (base.hidden.some((o) => o.id === office.id)) draft.restore = draft.restore.filter((id) => id !== office.id);
            else draft.hide.push(office.id);
            keep();
            edit();
          }, "link");
    card.append(
      h("header", null, h("h3", null, office.name, isNew && h("span", { class: "new" }, "nuevo")), hideButton),
      h(
        "div",
        { class: "holders" },
        ...holders.map((c) => holderLine(c, () => redraw())),
        ...rows.map((r) => rowLine(r, () => redraw())),
        h(
          "div",
          null,
          button("+ Otra persona", async () => {
            draft.rows.push({ key: nextKey++, office: office.id, name: "", email: "" });
            keep();
            const people = redraw().querySelectorAll<HTMLInputElement>(".person input:first-child");
            people[people.length - 1]?.focus();
          }, "link"),
        ),
      ),
    );
    return card;
  }

  function holderLine(charge: Charge, redraw: () => void): HTMLElement {
    const ends = draft.release.includes(charge.id);
    return h(
      "div",
      { class: `holder${ends ? " ends" : ""}` },
      h("span", null, charge.holder.name, " ", h("span", { class: "muted small" }, `${charge.holder.email ?? "sin correo"}, desde ${charge.term.start_year}`)),
      button(ends ? "Deshacer" : "Termina", async () => {
        draft.release = ends ? draft.release.filter((id) => id !== charge.id) : [...draft.release, charge.id];
        keep();
        redraw();
      }, "link"),
    );
  }

  function rowLine(row: Row, redraw: () => void): HTMLElement {
    const name = h("input", { value: row.name, placeholder: "Nombre", autocomplete: "off", "aria-label": "Nombre" });
    name.setAttribute("list", "personas");
    const email = h("input", { value: row.email, type: "email", placeholder: "Correo", autocomplete: "off", "aria-label": "Correo" });
    name.oninput = () => {
      row.name = name.value;
      keep();
    };
    name.onchange = () => {
      const known = people().get(name.value.trim());
      if (known && !email.value) {
        email.value = known;
        row.email = known;
      }
      keep();
      refreshPeople();
    };
    email.oninput = () => {
      row.email = email.value;
      keep();
    };
    const extra = draft.rows.filter((r) => r.office === row.office).length > 1;
    return h(
      "div",
      { class: "person" },
      name,
      email,
      extra &&
        button("×", async () => {
          draft.rows = draft.rows.filter((r) => r.key !== row.key);
          keep();
          redraw();
        }, "link icon"),
    );
  }

  function newOfficePanel(): HTMLElement {
    const name = h("input", { placeholder: "Por ejemplo: Coordinador de multimedia", autocomplete: "off" });
    const board = h("input", { type: "checkbox" });
    const form = h(
      "form",
      { class: "sheet" },
      h("h3", null, "Oficio propio de la iglesia"),
      h("p", { class: "muted small" }, "Para un oficio que el Manual no trae y que la iglesia votó crear."),
      h("label", null, "Nombre del oficio", name),
      h("div", { class: "row-form" }, h("label", { class: "check" }, board, "Miembro de la junta directiva"), h("button", null, "Agregar")),
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      const title = name.value.trim();
      if (!title) return;
      let id = slug(title);
      while (allOffices().some((o) => o.id === id)) id += "-2";
      draft.added.push({ id, name: title, board_member: board.checked });
      keep();
      edit();
    };
    return form;
  }

  function unusedPanel(unused: CatalogOffice[]): HTMLElement {
    return h(
      "details",
      { class: "unused" },
      h("summary", null, `Oficios que la iglesia no usa (${unused.length})`),
      h(
        "ul",
        { class: "rows" },
        ...unused.map((o) =>
          h(
            "li",
            null,
            h("span", { class: "grow" }, o.name),
            button("Usar", async () => {
              if (draft.hide.includes(o.id)) draft.hide = draft.hide.filter((id) => id !== o.id);
              else draft.restore.push(o.id);
              keep();
              edit();
            }, "link"),
          ),
        ),
      ),
    );
  }

  // ---- The change the draft amounts to ----

  function filled(): Row[] {
    return draft.rows.filter((r) => r.name.trim() !== "" && isUsed(r.office));
  }

  function toChange(): Change {
    const hidden = new Set(draft.hide);
    // A hidden office keeps no holders, so hiding it ends their charges.
    const release = base.charges.filter((c) => draft.release.includes(c.id) || hidden.has(c.office)).map((c) => c.id);
    // A name written once with its email and again without it is one person.
    const known = people();
    const elect: NewCharge[] = filled().map((r) => ({
      office: r.office,
      holder: { name: r.name.trim(), email: r.email.trim() || known.get(r.name.trim()) || null },
      term: { start_year: draft.term_year, length: draft.two_years ? "two_years" : "one_year", extended: false },
    }));
    const church = draft.church.trim();
    return {
      church: base.first || church !== base.church ? church : null,
      year_starts: base.first || draft.year_starts !== base.year_starts ? draft.year_starts : null,
      catalog: {
        offices: draft.added.map((o) => ({ ...o, page: null, approved_by: null, variant_of: null, responsibilities: [], layer: "" })),
        hide: draft.hide,
        restore: draft.restore,
        board_agenda: null,
      },
      elect,
      release,
    };
  }

  // ---- Review and save ----

  function review() {
    const change = toChange();
    if (!draft.church.trim()) {
      notify("Falta el nombre de la iglesia.", "error");
      return;
    }
    const nothing =
      change.church === null &&
      change.year_starts === null &&
      change.elect.length === 0 &&
      change.release.length === 0 &&
      change.catalog.offices.length === 0 &&
      change.catalog.hide.length === 0 &&
      change.catalog.restore.length === 0;
    if (nothing) {
      notify("No hay cambios que guardar.", "error");
      return;
    }
    // Re-electing someone for a later year is a new term; for the same year it would hold the office twice.
    const twice = change.elect.find((e) =>
      base.charges.some(
        (c) =>
          c.office === e.office &&
          c.term.start_year === e.term.start_year &&
          !change.release.includes(c.id) &&
          (c.holder.email ? c.holder.email === e.holder.email : c.holder.name === e.holder.name),
      ),
    );
    if (twice) {
      notify(`${twice.holder.name} ya es ${officeName(twice.office)} desde ${twice.term.start_year}.`, "error");
      return;
    }

    const byPerson = new Map<string, { name: string; email: string | null; offices: string[] }>();
    for (const c of change.elect) {
      const key = c.holder.email ?? `nombre:${c.holder.name.toLowerCase()}`;
      const person = byPerson.get(key) ?? { name: c.holder.name, email: c.holder.email, offices: [] };
      person.offices.push(officeName(c.office));
      byPerson.set(key, person);
    }
    const ending = base.charges.filter((c) => change.release.includes(c.id));
    const churchChanges = [
      change.church !== null && !base.first && `La iglesia pasa a llamarse ${change.church}.`,
      change.year_starts !== null &&
        `El año eclesiástico empieza en ${monthName(change.year_starts)}${base.first ? "" : ` (antes, ${monthName(base.year_starts)})`}.`,
      ...change.catalog.offices.map((o) => `Se crea el oficio ${o.name}${o.board_member ? ", miembro de la junta directiva" : ""}.`),
      ...change.catalog.hide.map((id) => `La iglesia deja de usar ${officeName(id)}.`),
      ...change.catalog.restore.map((id) => `La iglesia vuelve a usar ${officeName(id)}.`),
    ].filter((line): line is string => typeof line === "string");

    const term = `${draft.two_years ? "dos años" : "un año"} desde ${draft.term_year} (${churchYearSpan(draft.term_year, draft.year_starts)})`;
    const date = h("input", { type: "date", required: true, value: draft.date });
    const minute = h("input", { value: draft.minute, placeholder: "Por ejemplo: Acta 12/2026" });
    // The stamp shows exactly what saving records, filling in as the vote is written.
    const preview = h("div");
    const restamp = () =>
      preview.replaceChildren(stamp(draft.date ? stampLines({ kind: "vote", body: "church", date: draft.date, minute: draft.minute.trim() || null }) : []));
    restamp();
    date.oninput = () => {
      draft.date = date.value;
      keep();
      restamp();
    };
    minute.oninput = () => {
      draft.minute = minute.value;
      keep();
      restamp();
    };

    const save = async () => {
      const before = Math.max(0, ...base.charges.map((c) => c.id));
      if (base.first) {
        await api("/api/setup/initial", "POST", change);
      } else {
        if (!draft.date) {
          date.reportValidity();
          throw new Error("Falta la fecha del voto.");
        }
        const entry: NewEntry = {
          after: base.latest,
          vote: { body: "church", date: draft.date, minute: draft.minute.trim() || null },
          change,
        };
        await api("/api/setup/history", "POST", entry);
      }
      saved.remove(DRAFT_KEY);
      onSaved(before + 1);
    };

    fill(page,
      h("header", { class: "intro" }, h("h1", null, "Revisar antes de guardar"), h("p", null, base.first ? draft.church : `${base.church}`)),
      churchChanges.length > 0 && h("section", null, h("h2", null, "La iglesia"), h("ul", { class: "rows" }, ...churchChanges.map((l) => h("li", null, l)))),
      byPerson.size > 0 &&
        h(
          "section",
          null,
          h("h2", null, `Elegidos (${byPerson.size} ${byPerson.size === 1 ? "persona" : "personas"})`),
          h("p", { class: "muted" }, `Por ${term}.`),
          h(
            "ul",
            { class: "rows" },
            ...[...byPerson.values()]
              .sort((a, b) => a.name.localeCompare(b.name, "es"))
              .map((p) =>
                h(
                  "li",
                  null,
                  h(
                    "div",
                    { class: "grow" },
                    h("strong", null, p.name),
                    " ",
                    p.email ? h("span", { class: "muted small" }, p.email) : h("span", { class: "warn small" }, "sin correo: no podrá entrar"),
                    h("div", { class: "sub" }, andList(p.offices)),
                  ),
                ),
              ),
          ),
        ),
      ending.length > 0 &&
        h(
          "section",
          null,
          h("h2", null, "Terminan su cargo"),
          h("ul", { class: "rows" }, ...ending.map((c) => h("li", null, `${officeName(c.office)}: ${c.holder.name}`))),
        ),
      base.first
        ? h("section", { class: "sheet" }, h("p", null, "Esta es la configuración inicial: no lleva voto. Después podrás enviar las invitaciones."))
        : h(
            "section",
            { class: "sheet" },
            h("h2", null, "El voto"),
            h(
              "p",
              { class: "muted small" },
              "La elección de oficiales y los cambios de oficios los vota la iglesia, en el culto del sábado o en una reunión administrativa (Manual, p. 145).",
            ),
            h("div", { class: "form" }, h("label", null, "Fecha del voto de la iglesia", date), h("label", null, "Acta (opcional)", minute)),
            preview,
          ),
      h(
        "div",
        { class: "actions sticky" },
        button("Volver a editar", async () => edit()),
        button(base.first ? "Guardar configuración" : "Guardar voto", save, "primary"),
      ),
    );
    window.scrollTo(0, 0);
  }

  edit();
  return page;
}

/** Invitations for the people a save elected: one per person, sent only on a click. */
export async function invitations(setup: Setup, from: number, viewer: string, done: () => void): Promise<HTMLElement> {
  const last = (await api<Entry[]>("/api/setup/history")).at(-1);
  const officeName = (id: string) => setup.catalog.offices.find((o) => o.id === id)?.name ?? id;
  const elected = setup.charges.filter((c) => c.id >= from);
  const byEmail = new Map<string, Charge[]>();
  // Whoever is saving has signed in already and needs no invitation.
  for (const c of elected) if (c.holder.email && c.holder.email !== viewer) byEmail.set(c.holder.email, [...(byEmail.get(c.holder.email) ?? []), c]);
  const without = elected.filter((c) => !c.holder.email);

  const sends: (() => Promise<void>)[] = [];
  const list = h(
    "ul",
    { class: "rows" },
    ...[...byEmail.entries()].map(([email, charges]) => {
      const status = h("span", { class: "muted small" });
      let sent = false;
      const send = async () => {
        if (sent) return;
        try {
          await api(`/api/setup/charges/${charges[0]!.id}/invitation`, "POST");
          sent = true;
          status.textContent = "Invitación enviada";
          status.className = "done small";
          action.remove();
        } catch (e) {
          status.textContent = (e as Error).message;
          status.className = "warn small";
        }
      };
      sends.push(send);
      const action = button("Invitar", send);
      return h(
        "li",
        null,
        h(
          "div",
          { class: "grow" },
          h("strong", null, charges[0]!.holder.name),
          " ",
          h("span", { class: "muted small" }, email),
          h("div", { class: "sub" }, andList(charges.map((c) => officeName(c.office)))),
          status,
        ),
        action,
      );
    }),
  );

  return h(
    "div",
    { class: "stack" },
    h(
      "header",
      { class: "intro" },
      h("h1", null, "Guardado"),
      h("p", null, "Invita a los elegidos para que puedan entrar. Cada persona recibe un solo correo, aunque tenga varios cargos."),
    ),
    last && stamp(stampLines(last.approval), { pressed: true }),
    byEmail.size > 0
      ? h(
          "section",
          null,
          h(
            "div",
            { class: "actions start" },
            button("Invitar a todos", async () => {
              for (const send of sends) await send();
            }, "primary"),
          ),
          list,
        )
      : h("p", null, "Nadie elegido tiene correo, así que no hay invitaciones que enviar."),
    without.length > 0 &&
      h(
        "section",
        null,
        h("h2", null, "Sin correo"),
        h("p", { class: "muted" }, "No podrán entrar hasta que un voto registre su correo."),
        h("ul", { class: "rows" }, ...without.map((c) => h("li", null, `${c.holder.name}: ${officeName(c.office)}`))),
      ),
    h("div", { class: "actions" }, button("Listo", async () => done())),
  );
}

function slug(text: string): string {
  return fold(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

