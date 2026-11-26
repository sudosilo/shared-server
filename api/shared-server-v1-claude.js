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

// Browser apps on other sites that may call this server.
const ORIGINS = [/^https:\/\/2026-11-22-orange-hubview[a-z0-9-]*\.vercel\.app$/];

module.exports = async function handler(req, res) {
  res.setHeader("content-type", "application/json");
  const origin = String(req.headers.origin || "");
  if (ORIGINS.some((r) => r.test(origin))) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
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
    const messages = [{ role: "user", content: app.buildUser(body) }];
    let data = null;
    for (let turn = 0; turn < 3; turn++) {
      const payload = { model: app.model, max_tokens: app.maxTokens, system: app.system, messages };
      if (app.tools) payload.tools = app.tools;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("ai " + r.status + " " + t.slice(0, 200));
        let why = "";
        try { why = (JSON.parse(t).error || {}).type || ""; } catch (e) { why = ""; }
        return res.status(502).json({ error: "ai failed", status: r.status, why });
      }
      data = await r.json();
      if (data.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: data.content });
    }
    // With web search the answer is the text written after the last search result.
    const blocks = data.content || [];
    let from = 0;
    blocks.forEach((b, i) => { if (b.type === "web_search_tool_result") from = i + 1; });
    const raw = blocks.slice(from).filter((b) => b.type === "text").map((b) => b.text).join("");
    return res.status(200).json(app.finish ? app.finish(raw) : { text: raw });
  } catch (e) {
    console.error(e.message);
    return res.status(500).json({ error: "shared server failed" });
  }
};
