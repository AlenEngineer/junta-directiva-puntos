import type { Meeting } from "./generated/Meeting";
import type { NewItem } from "./generated/NewItem";
import type { NewMeeting } from "./generated/NewMeeting";
import type { Setup } from "./generated/Setup";

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${path}: ${res.status}`);
  return data as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, ...children: Node[]) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  node.append(...children);
  return node;
}

function button(label: string, action: () => Promise<unknown>) {
  const b = el("button", label);
  b.type = "button";
  b.onclick = () => action().then(render, (e: Error) => alert(e.message));
  return b;
}

const { church, catalog, charges } = await api<Setup>("/api/setup");

const stateLabel = { draft: "Borrador", called: "Convocada", held: "Celebrada" } as const;
const nextLabel = { draft: "Convocar", called: "Marcar como celebrada", held: null } as const;

function officeName(id: string): string {
  return catalog.offices.find((o) => o.id === id)?.name ?? id;
}

function addItemForm(meeting: Meeting): HTMLElement {
  const section = el("select");
  section.append(...meeting.sections.map((s) => Object.assign(el("option", s.title), { value: s.id })));
  const title = Object.assign(el("input"), { placeholder: "Punto", required: true });
  const form = el("form", undefined, section, title, el("button", "Agregar punto"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const item: NewItem = { section: section.value, title: title.value, kind: "informative", presenter: null };
    api(`/api/meetings/${meeting.id}/items`, "POST", item).then(render, (e: Error) => alert(e.message));
  };
  return form;
}

function meetingView(meeting: Meeting): HTMLElement {
  const next = nextLabel[meeting.state];
  const sections = meeting.sections.map((section) => {
    const items = meeting.items
      .filter((i) => i.section === section.id)
      .map((i) =>
        el(
          "li",
          `${i.title} (${i.status}) `,
          ...(meeting.state === "draft" ? [button("Quitar", () => api(`/api/meetings/${meeting.id}/items/${i.id}`, "DELETE"))] : []),
        ),
      );
    return el("li", section.title, el("ul", undefined, ...items));
  });
  return el(
    "article",
    undefined,
    el("h3", `Junta directiva · ${meeting.date} · ${stateLabel[meeting.state]}`),
    ...(next ? [button(next, () => api(`/api/meetings/${meeting.id}/advance`, "POST"))] : []),
    el("ol", undefined, ...sections),
    ...(meeting.state === "draft" ? [addItemForm(meeting)] : []),
  );
}

function newMeetingForm(): HTMLElement {
  const date = Object.assign(el("input"), { type: "date", required: true });
  const form = el("form", undefined, date, el("button", "Nueva junta"));
  form.onsubmit = (event) => {
    event.preventDefault();
    const meeting: NewMeeting = { date: date.value, kind: "regular" };
    api("/api/meetings", "POST", meeting).then(render, (e: Error) => alert(e.message));
  };
  return form;
}

async function render() {
  const meetings = await api<Meeting[]>("/api/meetings");
  const runsAgenda = charges.some((c) => c.responsibilities.some((r) => r.module === "agenda"));
  document.getElementById("app")!.replaceChildren(
    el("h1", church),
    ...charges.map((charge) =>
      el(
        "section",
        undefined,
        el("h2", `${officeName(charge.office)} · ${charge.term.start_year}`),
        el("ul", undefined, ...charge.responsibilities.map((r) => el("li", r.page ? `${r.summary} (p. ${r.page})` : r.summary))),
      ),
    ),
    ...(runsAgenda ? [el("h2", "Juntas directivas"), newMeetingForm(), ...meetings.map(meetingView)] : []),
    el("footer", catalog.layers.join(" + ")),
  );
}

await render();
