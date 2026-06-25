import { onRequestGet, onRequestOptions } from "./functions/api/live.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/live") {
      if (request.method === "OPTIONS") return onRequestOptions({ request, env, ctx });
      if (request.method === "GET") return onRequestGet({ request, env, ctx });
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, OPTIONS" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
