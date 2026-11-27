/** What every page shares: the API, building elements, and Spanish labels. */

export const root = document.getElementById("app")!;

const loginFailure = new URLSearchParams(location.search).get("login");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
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
  if (!res.ok) throw new ApiError(data?.error ?? `${path}: ${res.status}`, res.status);
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
  root.replaceChildren(
    h("main", null, h("div", { class: "stack" }, h("h1", null, "Mayordomo"), h("p", null, why), h("p", null, h("a", { href: "/api/auth/login", class: "button primary" }, "Iniciar sesión")))),
  );
}

type Child = Node | string | null | undefined | false;

/** An element with properties (or attributes, for names that are not properties) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") node.className = String(value);
    else if (name in node) Reflect.set(node, name, value);
    else node.setAttribute(name, String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** Replaces `node`'s children, skipping the ones left out with `false` or `null`. */
export function fill(node: Element, ...children: Child[]) {
  node.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

/** A button that runs `action`, stays disabled while it runs, and shows what went wrong. */
export function button(label: string, action: () => Promise<unknown> | void, cls = ""): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls }, label);
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

/** A message at the bottom of the screen that goes away by itself. */
export function notify(message: string, kind: "error" | "ok" = "ok") {
  const toast = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  document.body.append(toast);
  setTimeout(() => toast.remove(), kind === "error" ? 8000 : 4000);
}

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

/** "octubre de 2026 a septiembre de 2027" for church year 2026 starting in October. */
export function churchYearSpan(year: number, starts: number): string {
  if (starts === 1) return `enero a diciembre de ${year}`;
  return `${monthName(starts)} de ${year} a ${monthName(starts - 1)} de ${year + 1}`;
}

const longFormat = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" });
const conjunction = new Intl.ListFormat("es", { type: "conjunction" });

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "22 de noviembre de 2026" for "2026-11-22". */
export function longDate(iso: string): string {
  return longFormat.format(utc(iso));
}

/** "Martes 8 de diciembre" for "2026-12-08". */
export function dayDate(iso: string): string {
  const text = dayFormat.format(utc(iso)).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const dayMonthFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });

/** "1 de diciembre". */
export function dayMonth(iso: string): string {
  return dayMonthFormat.format(utc(iso));
}

/** The stacked date of a row: "Mar" over "8". */
export function dateMark(iso: string): HTMLElement {
  const day = shortDay.format(utc(iso)).replace(".", "");
  return h("div", { class: "date" }, day.charAt(0).toUpperCase() + day.slice(1), h("b", null, String(utc(iso).getUTCDate())));
}

/** Today as `YYYY-MM-DD`, in UTC like the server's church year. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Anciano y Tesorero". */
export function andList(items: string[]): string {
  return conjunction.format(items);
}

/**
 * The church's stamp, pressed only on what a body recorded. With no lines it
 * is the empty outline of a vote not yet saved.
 */
export function stamp(lines: string[], options: { pressed?: boolean; small?: boolean } = {}): HTMLElement {
  const unset = lines.length === 0;
  const cls = ["stamp", unset && "unset", options.pressed && "pressed", options.small && "small"].filter(Boolean).join(" ");
  const node = h("div", { class: cls }, ...(unset ? ["Sin sellar"] : lines).flatMap((line, i) => (i === 0 ? [line] : [h("br"), line])));
  if (!unset) node.setAttribute("role", "img");
  if (!unset) node.setAttribute("aria-label", lines.join(", "));
  return node;
}

/** Storage that may be missing (private windows, blocked site data). */
export const saved = {
  get<T>(key: string): T | null {
    try {
      const text = localStorage.getItem(key);
      return text ? (JSON.parse(text) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The draft only lives on screen, then.
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing was stored.
    }
  },
};

/** Lowercase with accents removed, so a search for "jovenes" finds "Jóvenes". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
