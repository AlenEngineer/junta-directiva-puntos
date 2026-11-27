/** The board's meetings: everyone on the board reads them, whoever runs the board edits them. */

import type { ItemStatus } from "./generated/ItemStatus";
import type { Meeting } from "./generated/Meeting";
import type { NewItem } from "./generated/NewItem";
import type { NewMeeting } from "./generated/NewMeeting";
import type { Viewer } from "./generated/Viewer";
import { api, button, h, notify } from "./ui";

const stateLabel = { draft: "Borrador", called: "Convocada", held: "Celebrada" } as const;
const nextLabel = { draft: "Convocar", called: "Marcar como celebrada", held: null } as const;
const statusLabel: Record<ItemStatus, string> = { proposed: "propuesto", approved: "aprobado", discussed: "tratado" };

export async function boardView(me: Viewer, refresh: () => void): Promise<HTMLElement> {
  const meetings = await api<Meeting[]>("/api/meetings");
  return h(
    "section",
    { class: "stack" },
    h("h2", null, "Juntas directivas"),
    me.may.run_board && newMeetingForm(refresh),
    meetings.length === 0 && h("p", { class: "muted" }, "Todavía no hay juntas."),
    ...meetings.map((m) => meetingView(me, m, refresh)),
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
          `${i.title} `,
          h("span", { class: "tag" }, statusLabel[i.status]),
          editable && button("Quitar", () => api(`/api/meetings/${meeting.id}/items/${i.id}`, "DELETE").then(refresh), "link"),
        ),
      );
    return h("li", null, section.title, items.length > 0 && h("ul", null, ...items));
  });
  return h(
    "article",
    { class: "panel" },
    h("h3", null, `${meeting.date} · ${stateLabel[meeting.state]}`),
    next && button(next, () => api(`/api/meetings/${meeting.id}/advance`, "POST").then(refresh)),
    h("ol", null, ...sections),
    editable && addItemForm(meeting, refresh),
  );
}

function addItemForm(meeting: Meeting, refresh: () => void): HTMLElement {
  const section = h("select", null, ...meeting.sections.map((s) => h("option", { value: s.id }, s.title)));
  const title = h("input", { placeholder: "Punto", required: true });
  const form = h("form", { class: "row" }, section, title, h("button", null, "Agregar punto"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const item: NewItem = { section: section.value, title: title.value, kind: "informative", presenter: null };
    api(`/api/meetings/${meeting.id}/items`, "POST", item).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}

function newMeetingForm(refresh: () => void): HTMLElement {
  const date = h("input", { type: "date", required: true });
  const form = h("form", { class: "row" }, date, h("button", null, "Nueva junta"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const meeting: NewMeeting = { date: date.value, kind: "regular" };
    api("/api/meetings", "POST", meeting).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}
