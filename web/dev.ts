import index from "./index.html";

const api = process.env.API_URL ?? "http://127.0.0.1:3000";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5173),
  development: true,
  routes: {
    "/": index,
    "/api/*": (req) => {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      // The server names the sign-in callback after the host the browser used.
      headers.set("x-forwarded-host", url.host);
      // Signing in and out are redirects for the browser to follow, not this proxy.
      return fetch(new URL(url.pathname + url.search, api), { method: req.method, headers, body: req.body, redirect: "manual" });
    },
  },
});

console.log(`web on ${server.url}, proxying /api to ${api}`);
