import type { Catalog } from "./generated/Catalog";
import type { Charge } from "./generated/Charge";
import type { Meeting } from "./generated/Meeting";
import type { Office } from "./generated/Office";

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

const [catalog, charges, meetings] = await Promise.all([
  get<Catalog>("/api/catalog"),
  get<Charge[]>("/api/charges"),
  get<Meeting[]>("/api/meetings"),
]);

function officeName(office: Office): string {
  if (office.kind === "local") return office.name;
  return catalog.offices.find((o) => o.id === office.id)?.name ?? office.id;
}

function meetingView(meeting: Meeting): HTMLElement {
  const sections = meeting.sections.map((section) => {
    const items = meeting.items.filter((i) => i.section === section.id);
    return el("li", section.title, el("ul", undefined, ...items.map((i) => el("li", `${i.title} (${i.status})`))));
  });
  return el("article", undefined, el("h3", `Junta directiva · ${meeting.date} · ${meeting.state}`), el("ol", undefined, ...sections));
}

document.getElementById("app")!.replaceChildren(
  ...charges.map((charge) =>
    el(
      "section",
      undefined,
      el("h2", `${officeName(charge.office)} · ${charge.term.start_year}`),
      el("ul", undefined, ...charge.responsibilities.map((r) => el("li", r.page ? `${r.summary} (p. ${r.page})` : r.summary))),
      ...meetings.filter((m) => m.charge === charge.id).map(meetingView),
    ),
  ),
  el("footer", catalog.edition),
);
