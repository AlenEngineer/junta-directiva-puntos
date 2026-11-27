import type { Catalog } from "./generated/Catalog";
import type { Charge } from "./generated/Charge";
import type { Meeting } from "./generated/Meeting";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, ...children: Node[]) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  node.append(...children);
  return node;
}

const [church, catalog, charges, meetings] = await Promise.all([
  get<{ name: string }>("/api/church"),
  get<Catalog>("/api/catalog"),
  get<Charge[]>("/api/charges"),
  get<Meeting[]>("/api/meetings"),
]);

function officeName(id: string): string {
  return catalog.offices.find((o) => o.id === id)?.name ?? id;
}

function agendaTemplate(): HTMLElement {
  return el("ol", undefined, ...catalog.board_agenda.map((s) => el("li", s.title)));
}

function meetingView(meeting: Meeting): HTMLElement {
  const sections = meeting.sections.map((section) => {
    const items = meeting.items.filter((i) => i.section === section.id);
    return el("li", section.title, el("ul", undefined, ...items.map((i) => el("li", `${i.title} (${i.status})`))));
  });
  return el("article", undefined, el("h3", `Junta directiva · ${meeting.date} · ${meeting.state}`), el("ol", undefined, ...sections));
}

document.getElementById("app")!.replaceChildren(
  el("h1", church.name),
  ...charges.map((charge) =>
    el(
      "section",
      undefined,
      el("h2", `${officeName(charge.office)} · ${charge.term.start_year}`),
      el("ul", undefined, ...charge.responsibilities.map((r) => el("li", r.page ? `${r.summary} (p. ${r.page})` : r.summary))),
      ...(charge.responsibilities.some((r) => r.module === "agenda")
        ? [el("h3", "Plantilla de agenda de la junta"), agendaTemplate()]
        : []),
      ...meetings.filter((m) => m.charge === charge.id).map(meetingView),
    ),
  ),
  el("footer", catalog.layers.join(" + ")),
);
