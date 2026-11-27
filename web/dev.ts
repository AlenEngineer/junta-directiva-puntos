import index from "./index.html";

const api = process.env.API_URL ?? "http://127.0.0.1:3000";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5173),
  development: true,
  routes: {
    "/": index,
    "/api/*": (req) => {
      const url = new URL(req.url);
      return fetch(new URL(url.pathname + url.search, api), req);
    },
  },
});

console.log(`web on ${server.url}, proxying /api to ${api}`);
