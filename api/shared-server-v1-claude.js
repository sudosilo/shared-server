"use strict";

const APPS = require("../shared-server-v1-apps.js");
const KEY = process.env.ANTHROPIC_API_KEY || "";

// Simple per visitor limit until the shared Redis is attached.
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

module.exports = async function handler(req, res) {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, name: "shared-server-v1", ai: Boolean(KEY), apps: Object.keys(APPS) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    body = body || {};
    const app = APPS[body.app];
    if (!app) return res.status(404).json({ error: "unknown app" });
    if (!body.text) return res.status(400).json({ error: "no text" });
    if (!KEY) return res.status(503).json({ error: "no ai key" });
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (tooMany(body.app + ":" + ip)) return res.status(429).json({ error: "slow down" });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: app.model,
        max_tokens: app.maxTokens,
        system: app.system,
        messages: [{ role: "user", content: app.buildUser(body) }]
      })
    });
    if (!r.ok) {
      console.error("ai " + r.status + " " + (await r.text()).slice(0, 200));
      return res.status(502).json({ error: "ai failed" });
    }
    const data = await r.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return res.status(200).json(app.finish ? app.finish(raw) : { text: raw });
  } catch (e) {
    console.error(e.message);
    return res.status(500).json({ error: "shared server failed" });
  }
};
