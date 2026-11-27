/**
 * Inicio: what is the viewer's across all their charges. "Para hacer" comes
 * only from the data, never from a hand-kept list.
 */

import type { Meeting } from "./generated/Meeting";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";
import { andList, api, button, dateMark, dayDate, dayMonth, h, today } from "./ui";

type Todo = { title: string; detail: string; action: HTMLElement };

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const linkButton = (href: string, label: string) => h("a", { href, class: "button" }, label);

export async function home(me: Viewer, setup: Setup | null, refresh: () => void): Promise<HTMLElement> {
  const meetings = me.may.read_board ? await api<Meeting[]>("/api/meetings") : [];
  const now = today();
  const todos: Todo[] = [];

  if (me.may.run_board) {
    for (const m of meetings) {
      const points = m.items.length === 1 ? "1 punto" : `${m.items.length} puntos`;
      if (m.state === "draft")
        todos.push({ title: `Junta del ${dayMonth(m.date)}`, detail: `Sin convocar, con ${points}`, action: linkButton("#/junta", "Ver la agenda") });
      else if (m.state === "called" && m.date < now)
        todos.push({
          title: `Junta del ${dayMonth(m.date)}`,
          detail: "Ya pasó y sigue convocada",
          action: button("Marcar como celebrada", () => api(`/api/meetings/${m.id}/advance`, "POST").then(refresh)),
        });
    }
  }
  if (me.may.record_votes && setup) {
    const without = setup.charges.filter((c) => setup.serving.includes(c.id) && !c.holder.email);
    const names = [...new Set(without.map((c) => c.holder.name))];
    if (names.length > 0)
      todos.push({
        title: names.length === 1 ? "Un oficial sin correo" : `${names.length} oficiales sin correo`,
        detail: `${andList(names.slice(0, 3))}${names.length > 3 ? " y otros" : ""} ${names.length === 1 ? "no puede" : "no pueden"} entrar`,
        action: linkButton("#/iglesia", "Ver oficiales"),
      });
  }

  const week = meetings.filter((m) => m.state !== "held" && m.date >= now && m.date <= addDays(now, 7));
  const officeName = (id: string) => setup?.catalog.offices.find((o) => o.id === id)?.name ?? id;
  const date = dayDate(now);

  return h(
    "div",
    { class: "stack" },
    h("header", { class: "intro" }, h("h1", null, `${greeting()}, ${me.name.split(" ")[0]}`), h("p", null, date)),
    todos.length > 0 &&
      h(
        "section",
        { class: "needs", "aria-labelledby": "hacer" },
        h("h2", { id: "hacer", class: "label" }, "Para hacer"),
        h(
          "ul",
          { class: "rows" },
          ...todos.map((t) => h("li", null, h("div", { class: "grow" }, h("strong", null, t.title), h("div", { class: "sub" }, t.detail)), t.action)),
        ),
      ),
    week.length > 0 &&
      h(
        "section",
        { "aria-labelledby": "semana" },
        h("h2", { id: "semana", class: "label" }, "Esta semana"),
        h(
          "ul",
          { class: "rows" },
          ...week.map((m) =>
            h(
              "li",
              null,
              dateMark(m.date),
              h(
                "a",
                { href: "#/junta", class: "grow plain-link" },
                "Junta directiva",
                h("div", { class: "sub" }, m.state === "called" ? "Convocada" : "Sin convocar"),
              ),
            ),
          ),
        ),
      ),
    h(
      "section",
      { "aria-labelledby": "cargos" },
      h("h2", { id: "cargos", class: "label" }, "Mis cargos"),
      me.charges.length > 0
        ? h(
            "div",
            null,
            ...me.charges.map((c) =>
              h("a", { href: `#/cargo/${c.id}`, class: "desk-link" }, h("span", null, officeName(c.office)), h("span", null, `desde ${c.term.start_year}`)),
            ),
          )
        : h("p", { class: "muted" }, "No tienes un cargo vigente en esta iglesia."),
    ),
  );
}
