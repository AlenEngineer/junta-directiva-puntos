import type { Charge } from "./generated/Charge";
import type { Meeting } from "./generated/Meeting";
import type { NewItem } from "./generated/NewItem";
import type { NewMeeting } from "./generated/NewMeeting";
import type { Setup } from "./generated/Setup";
import type { Viewer } from "./generated/Viewer";

const app = document.getElementById("app")!;
const loginFailure = new URLSearchParams(location.search).get("login");

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signIn();
    // The page is leaving or now shows the sign-in, so the caller must not go on.
    return new Promise<T>(() => {});
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${path}: ${res.status}`);
  return data as T;
}

/**
 * Sends the browser to sign in. Right after a failed sign-in, going straight
 * back could loop, so the page says why and waits for a click instead.
 */
function signIn() {
  if (!loginFailure) {
    location.assign("/api/auth/login");
    return;
  }
  const why = loginFailure === "unverified" ? "Tu correo no está verificado." : "No se pudo iniciar sesión.";
  app.replaceChildren(el("p", why), Object.assign(el("a", "Iniciar sesión"), { href: "/api/auth/login" }));
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

const me = await api<Viewer>("/api/me");
const setup = me.may.read_setup ? await api<Setup>("/api/setup") : null;

const stateLabel = { draft: "Borrador", called: "Convocada", held: "Celebrada" } as const;
const nextLabel = { draft: "Convocar", called: "Marcar como celebrada", held: null } as const;

function officeName(id: string): string {
  return setup?.catalog.offices.find((o) => o.id === id)?.name ?? id;
}

function chargeView(charge: Charge): HTMLElement {
  return el(
    "section",
    undefined,
    el("h2", `${officeName(charge.office)} · ${charge.term.start_year}`),
    el("ul", undefined, ...charge.responsibilities.map((r) => el("li", r.page ? `${r.summary} (p. ${r.page})` : r.summary))),
  );
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
  const next = me.may.run_board ? nextLabel[meeting.state] : null;
  const editable = me.may.run_board && meeting.state === "draft";
  const sections = meeting.sections.map((section) => {
    const items = meeting.items
      .filter((i) => i.section === section.id)
      .map((i) =>
        el(
          "li",
          `${i.title} (${i.status}) `,
          ...(editable ? [button("Quitar", () => api(`/api/meetings/${meeting.id}/items/${i.id}`, "DELETE"))] : []),
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
    ...(editable ? [addItemForm(meeting)] : []),
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
  const meetings = me.may.read_board ? await api<Meeting[]>("/api/meetings") : [];
  const signOut = Object.assign(el("form", undefined, el("button", "Salir")), { method: "post", action: "/api/auth/logout" });
  app.replaceChildren(
    el("header", `${me.name} · ${me.email} `, signOut),
    ...(setup ? [el("h1", setup.church)] : []),
    ...(me.charges.length > 0 ? me.charges.map(chargeView) : [el("p", "No tienes un cargo vigente en esta iglesia.")]),
    ...(me.may.read_board
      ? [el("h2", "Juntas directivas"), ...(me.may.run_board ? [newMeetingForm()] : []), ...meetings.map(meetingView)]
      : []),
    ...(setup ? [el("footer", setup.catalog.layers.join(" + "))] : []),
  );
}

await render();
