import type { Duty } from "./generated/Duty";
import type { Meeting } from "./generated/Meeting";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const app = document.getElementById("app")!;
const [duties, meetings] = await Promise.all([
  get<Duty[]>("/api/duties"),
  get<Meeting[]>("/api/meetings"),
]);

app.replaceChildren(
  ...duties.map((duty) => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = `${duty.title} · ${duty.term.year}`;
    const list = document.createElement("ul");
    for (const meeting of meetings.filter((m) => m.duty === duty.id)) {
      const li = document.createElement("li");
      li.textContent = `${meeting.date} ${meeting.title} (${meeting.state}, ${meeting.items.length} items)`;
      list.append(li);
    }
    section.append(heading, list);
    return section;
  }),
);
