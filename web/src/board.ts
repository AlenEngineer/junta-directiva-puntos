/** The board's meetings: everyone on the board reads them, whoever runs the board edits them. */

import type { ItemStatus } from "./generated/ItemStatus";
import type { Meeting } from "./generated/Meeting";
import type { NewItem } from "./generated/NewItem";
import type { NewMeeting } from "./generated/NewMeeting";
import type { Viewer } from "./generated/Viewer";
import { api, button, dayDate, h, notify, stamp, today } from "./ui";

const stateLabel = { draft: "Borrador", called: "Convocada", held: "Celebrada" } as const;
const nextLabel = { draft: "Convocar", called: "Marcar como celebrada", held: null } as const;

/** An approved item is a decision the board recorded, so it carries the stamp. */
function status(s: ItemStatus): HTMLElement {
  if (s === "approved") return stamp(["Aprobado"], { small: true });
  return h("span", { class: "muted small" }, s === "discussed" ? "Tratado" : "Propuesto");
}

export async function boardView(me: Viewer, refresh: () => void): Promise<HTMLElement> {
  const meetings = await api<Meeting[]>("/api/meetings");
  const now = today();
  const coming = meetings.filter((m) => m.state !== "held" || m.date >= now);
  const past = meetings.filter((m) => !coming.includes(m)).reverse();
  return h(
    "div",
    { class: "stack" },
    h("header", { class: "intro" }, h("h1", null, "Junta directiva"), h("p", null, "Las juntas y sus agendas.")),
    me.may.run_board && newMeetingForm(refresh),
    meetings.length === 0 && h("p", { class: "muted" }, "Todavía no hay juntas."),
    ...coming.map((m) => meetingView(me, m, refresh)),
    past.length > 0 && h("h2", null, "Juntas celebradas"),
    ...past.map((m) => meetingView(me, m, refresh)),
  );
}

function meetingView(me: Viewer, meeting: Meeting, refresh: () => void): HTMLElement {
  const next = me.may.run_board ? nextLabel[meeting.state] : null;
  const editable = me.may.run_board && meeting.state === "draft";
  const sections = meeting.sections.map((section) => {
    const items = meeting.items
      .filter((i) => i.section === section.id)
      .map((i) =>
        h(
          "li",
          null,
          h("span", null, i.title),
          status(i.status),
          editable && button("Quitar", () => api(`/api/meetings/${meeting.id}/items/${i.id}`, "DELETE").then(refresh), "link"),
        ),
      );
    return h("li", null, h("span", { class: "section" }, section.title), items.length > 0 && h("ul", { class: "items" }, ...items));
  });
  return h(
    "article",
    { class: "meeting" },
    h(
      "header",
      null,
      h("div", null, h("h2", null, dayDate(meeting.date)), h("p", { class: "muted small" }, stateLabel[meeting.state])),
      next && button(next, () => api(`/api/meetings/${meeting.id}/advance`, "POST").then(refresh)),
    ),
    h("ol", { class: "agenda" }, ...sections),
    editable && addItemForm(meeting, refresh),
  );
}

function addItemForm(meeting: Meeting, refresh: () => void): HTMLElement {
  const section = h("select", { "aria-label": "Sección" }, ...meeting.sections.map((s) => h("option", { value: s.id }, s.title)));
  const title = h("input", { placeholder: "Punto", required: true, "aria-label": "Punto" });
  const form = h("form", { class: "row-form add" }, section, title, h("button", null, "Agregar punto"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const item: NewItem = { section: section.value, title: title.value, kind: "informative", presenter: null };
    api(`/api/meetings/${meeting.id}/items`, "POST", item).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}

function newMeetingForm(refresh: () => void): HTMLElement {
  const date = h("input", { type: "date", required: true, "aria-label": "Fecha de la junta" });
  const form = h("form", { class: "row-form" }, date, h("button", { class: "primary" }, "Nueva junta"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const meeting: NewMeeting = { date: date.value, kind: "regular" };
    api("/api/meetings", "POST", meeting).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}
