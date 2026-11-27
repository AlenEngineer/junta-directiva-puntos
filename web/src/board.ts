/**
 * The board's meetings. Every board member reads them in Junta directiva;
 * whoever runs the board prepares and calls them from their own desk.
 */

import type { Meeting } from "./generated/Meeting";
import type { NewItem } from "./generated/NewItem";
import type { NewMeeting } from "./generated/NewMeeting";
import type { Request } from "./generated/Request";
import type { Viewer } from "./generated/Viewer";
import { outsideDesks } from "./desk";
import { api, button, dayDate, h, notify, today } from "./ui";

const stateLabel = { draft: "Borrador, sin convocar", called: "Convocada", held: "Celebrada" } as const;
const nextLabel = { draft: "Convocar", called: "Marcar como celebrada", held: null } as const;
type RequestKind = Extract<Request, string> | "approve_expense";
const requestLabel: Record<RequestKind, string> = {
  accept_report: "aceptar un informe",
  approve_plan: "aprobar un plan o actividad",
  approve_expense: "aprobar un gasto",
  recommend_to_church: "recomendar a la iglesia",
  other_decision: "otra decisión",
  inform: "solo informar",
};

function requestText(request: Request): string {
  if (typeof request === "string") return requestLabel[request];
  const amount = request.approve_expense.amount;
  return amount === null ? requestLabel.approve_expense : `${requestLabel.approve_expense} de B/. ${amount}`;
}

/** Junta directiva in La iglesia: read-only, unless the viewer runs the board without a desk for it. */
export async function boardView(me: Viewer, refresh: () => void): Promise<HTMLElement> {
  const meetings = await api<Meeting[]>("/api/meetings");
  const runs = outsideDesks(me, "run_board");
  const now = today();
  const coming = meetings.filter((m) => m.state !== "held" || m.date >= now);
  const past = meetings.filter((m) => !coming.includes(m)).reverse();
  return h(
    "div",
    { class: "stack" },
    h("header", { class: "intro" }, h("h1", null, "Junta directiva"), h("p", null, "Las juntas y sus agendas.")),
    runs && newMeetingForm(refresh),
    meetings.length === 0 && h("p", { class: "muted" }, "Todavía no hay juntas."),
    ...coming.map((m) => meetingView(m, runs, refresh)),
    past.length > 0 && h("h2", null, "Juntas celebradas"),
    ...past.map((m) => meetingView(m, false, refresh)),
  );
}

/**
 * One meeting's agenda, numbered as the board reads it. Sections with no
 * items are left out; with `runs`, a draft also takes new items.
 */
export function meetingView(meeting: Meeting, runs: boolean, refresh: () => void): HTMLElement {
  const next = runs ? nextLabel[meeting.state] : null;
  const editable = runs && meeting.state === "draft";
  const used = meeting.sections.filter((s) => meeting.items.some((i) => i.section === s.id));
  const sections = used.map((section, n) =>
    h(
      "li",
      null,
      h("h3", null, `${n + 1}. ${section.title}`),
      h(
        "ol",
        { class: "items" },
        ...meeting.items
          .filter((i) => i.section === section.id)
          .map((i, m) =>
            h(
              "li",
              null,
              h("span", { class: "num" }, `${n + 1}.${m + 1}`),
              h("div", { class: "grow" }, i.title, h("div", { class: "sub" }, [i.presenter, requestText(i.request)].filter(Boolean).join(", "))),
              editable && button("Quitar", () => api(`/api/meetings/${meeting.id}/items/${i.id}`, "DELETE").then(refresh), "link"),
            ),
          ),
      ),
    ),
  );
  return h(
    "article",
    { class: "meeting" },
    h(
      "header",
      null,
      h("div", null, h("h2", null, dayDate(meeting.date)), h("p", { class: "muted small" }, stateLabel[meeting.state])),
      next && button(next, () => api(`/api/meetings/${meeting.id}/advance`, "POST").then(refresh)),
    ),
    sections.length > 0 ? h("ol", { class: "agenda" }, ...sections) : h("p", { class: "muted" }, "La agenda no tiene puntos todavía."),
    editable && addItemForm(meeting, refresh),
  );
}

function addItemForm(meeting: Meeting, refresh: () => void): HTMLElement {
  const section = h("select", null, ...meeting.sections.map((s) => h("option", { value: s.id }, s.title)));
  const title = h("input", { required: true, autocomplete: "off" });
  const presenter = h("input", { placeholder: "Por ejemplo: Ministerio Joven", autocomplete: "off" });
  const kind = h("select", null, ...(Object.keys(requestLabel) as RequestKind[]).map((k) => h("option", { value: k }, requestLabel[k])));
  const form = h(
    "form",
    { class: "sheet" },
    h("h3", null, "Agregar un punto"),
    h(
      "div",
      { class: "form" },
      h("label", { class: "span2" }, "Punto", title),
      h("label", null, "Sección", section),
      h("label", null, "Qué le pide a la junta", kind),
      h("label", { class: "span2" }, "Lo presenta (opcional)", presenter),
    ),
    h("button", null, "Agregar punto"),
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    const chosen = kind.value as RequestKind;
    const request: Request = chosen === "approve_expense" ? { approve_expense: { amount: null } } : chosen;
    const item: NewItem = {
      section: section.value,
      office: null,
      title: title.value.trim(),
      presenter: presenter.value.trim() || null,
      request,
      explanation: "",
      received_on: null,
      scans: [],
      activity: null,
      plan: null,
    };
    api(`/api/meetings/${meeting.id}/items`, "POST", item).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}

export function newMeetingForm(refresh: () => void): HTMLElement {
  const date = h("input", { type: "date", required: true, "aria-label": "Fecha de la junta" });
  const form = h("form", { class: "row-form" }, date, h("button", { class: "primary" }, "Nueva junta"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const meeting: NewMeeting = { date: date.value, kind: "regular" };
    api("/api/meetings", "POST", meeting).then(refresh, (e: Error) => notify(e.message, "error"));
  };
  return form;
}
