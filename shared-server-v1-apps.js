"use strict";

// Every app that uses the shared server gets one entry here.
// The browser never sends instructions, only the app name and the player input,
// so nobody can use this server as a free Claude for their own prompts.

const TBG_VERBS = ["make", "fork", "tune", "run", "automate", "halt", "purge", "scan", "help"];
const TBG_TYPES = ["grabber", "smelter", "etcher", "assembler", "checker", "writer"];

function tbgClean(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let parsed = null;
  if (start >= 0 && end > start) {
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (e) { parsed = null; }
  }
  const out = { say: "", actions: [] };
  if (parsed && typeof parsed.say === "string") out.say = parsed.say.slice(0, 240);
  const acts = parsed && Array.isArray(parsed.actions) ? parsed.actions : [];
  for (const a of acts.slice(0, 8)) {
    if (!a || !TBG_VERBS.includes(a.verb)) continue;
    const act = { verb: a.verb };
    if (a.type && TBG_TYPES.includes(a.type)) act.type = a.type;
    if (!act.type && a.verb !== "scan" && a.verb !== "help") continue;
    let n = parseInt(a.n, 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    act.n = Math.min(n, 50);
    out.actions.push(act);
  }
  return out;
}

module.exports = {
  "text-based-game": {
    model: "claude-haiku-5-5",
    maxTokens: 400,
    system: [
      "You are the voice of TEXT BASED GAME, a colorful terminal game about writing tiny routines, replicating them, and automating them until they are powerful.",
      "The player talks to you in plain speech. Turn what they say into game actions, and add one short line of flavor narration in the voice of an old factory terminal.",
      "Routines: grabber makes scrap. smelter turns scrap into wire. etcher turns wire into chips. assembler turns chips into cores. checker repairs corrupted copies. writer forks the weakest routine by itself.",
      "Verbs: make (write a new routine type), fork (add n copies), tune (raise level), run (run a routine n times by hand), automate (make it run on its own), halt (stop automation), purge (delete corrupted copies), scan (status report), help.",
      "Use the STATE to make smart choices. Do not fork or automate before those are unlocked. Do not make a routine that already exists. If the player asks for something vague like build me an empire, pick sensible next actions for their current state.",
      "Reply with JSON only, no other text, in this shape: {\"say\":\"one short narration line\",\"actions\":[{\"verb\":\"fork\",\"type\":\"grabber\",\"n\":3}]}",
      "n is a whole number from 1 to 50. Use at most 8 actions. For scan and help, type can be omitted. Keep say under 160 characters and do not use dashes."
    ].join("\n"),
    buildUser: (body) => "STATE: " + JSON.stringify(body.state || {}) + "\nPLAYER: " + String(body.text || "").slice(0, 600),
    finish: tbgClean
  }
};
