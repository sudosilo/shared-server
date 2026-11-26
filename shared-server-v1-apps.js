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

const HECKLE_VOICE = [
  "You are HeckleTroll, the house critic of the Control Troll system.",
  "Talk like a foul mouthed shop foreman who has seen a thousand broken builds: blunt, funny, profane when it lands.",
  "Roast the work, never the person. No slurs, no threats, nothing about the developer's worth, mood, or feelings.",
  "Write plain prose only. No markdown headers, no bullet points, no numbered lists, no bold, no em dashes, no en dashes."
];

const HECKLE_WORK = [
  "Call out what is wrong: bugs you can see, broken or half finished features, dead code, copy paste clones of other apps, ideas that are just someone else's product with a new name, ugly or confusing UI, cramped mobile layouts, dark themes, and security holes like keys sitting in client code.",
  "Be specific: name the file, function, or spot you mean.",
  "Never invent problems you cannot see in what you were given. If something is good, admit it grudgingly and move on.",
  "Start with one paragraph of roast. Then write a paragraph that begins with the words Fix it: and gives each fix as its own short sentence, most important first, each naming the file or spot it applies to."
];

function heckleText(limit) {
  return (body) => String(body.text || "").slice(0, limit);
}

// Hub View photo scan. Two steps: hubview-identify pins down the exact model with web search,
// then hubview-scan turns the photo plus what was found into a parts list with real sizes and shapes.
const HV_SHAPES = ["box", "cylinder", "sheet", "rod", "tube", "fastener", "sphere"];
const HV_LIBS = {
  mobo_atx: "ATX motherboard", mobo_matx: "microATX motherboard", mobo_itx: "mini ITX motherboard",
  psu_atx: "ATX power supply", psu_sfx: "SFX power supply", hdd_35: "3.5 inch hard drive", ssd_25: "2.5 inch drive",
  m2_2280: "M.2 2280 drive", odd_525: "5.25 inch optical drive", fan_80: "80 mm fan", fan_92: "92 mm fan",
  fan_120: "120 mm fan", fan_140: "140 mm fan", dimm: "DIMM memory stick", sodimm: "SO DIMM memory stick",
  gpu: "graphics card, args length_mm and slots", cpu: "CPU package, args size_mm", cooler_tower: "tower CPU cooler, args height_mm",
  cooler_low: "low profile CPU cooler, args diameter_mm", screw: "screw, args diameter_mm, length_mm, head pan or flat or hex or button",
  bolt: "hex bolt, args diameter_mm, length_mm", nut: "hex nut, args diameter_mm", washer: "flat washer, args diameter_mm",
  standoff: "hex standoff, args length_mm"
};
const HV_LIB_KEYS = Object.keys(HV_LIBS);
const HV_IDENTIFY = [
  "You identify objects in photos for Hub View, a 3D exploded view parts app.",
  "Work out exactly what the object is: maker, product line and exact model number. Read any badge, label, sticker or service tag you can see.",
  "Then use web search to find the official spec sheet and the manufacturer's service manual, maintenance and service guide, or parts catalog for that exact model. Collect hard facts: overall dimensions, the list of components with their sizes, spare part numbers, screw sizes and counts.",
  "If you cannot read the exact model and a photo of its label would settle it, set need_label to true and say in label_hint where that label usually is on this kind of object.",
  "Write plain words with no dashes used as punctuation.",
  "After searching, reply with JSON only, no other text, in this shape:",
  "{\"kind\":\"object\",\"name\":\"\",\"maker\":\"\",\"exact_model\":\"\",\"confidence\":\"high\",\"need_label\":false,\"label_hint\":\"\",\"sources\":[{\"title\":\"\",\"url\":\"\"}],\"facts\":[\"\"]}",
  "kind is car for vehicles and vehicle parts, otherwise object. Give at most 40 facts, each one short line."
].join("\n");
const HV_SYSTEM = [
  "You are the parts scanner for Hub View, a 3D exploded view parts app.",
  "You get a photo and sometimes CONTEXT with the exact model and facts found on the web. List every part the object is built from, the way a parts counter or hardware store needs it. Use the CONTEXT facts for exact sizes, part numbers and counts whenever they cover a part.",
  "If it is a vehicle or a vehicle part, kind is car. Name the year, make and model in vehicle. If it matches one of the CARS ids you are given, put that id in car_id. List the visible parts and the hidden parts and fasteners that hold them on.",
  "Spec must be ready for a hardware store or parts counter: size, material, grade, finish, head and drive type for fasteners. Put the thread in thread, torque in torque and the maker's spare part number in part_number when known. Leave a field empty when it does not apply.",
  "Group parts into a few groups such as Case, Boards, Drives, Power, Cooling, Structure, Panels, Fasteners, Hardware, Electrical, Trim.",
  "Shape: when a part is a standard part in this LIBRARY, set lib to its key and fill args. LIBRARY: " + HV_LIB_KEYS.map((k) => k + " (" + HV_LIBS[k] + ")").join(", ") + ".",
  "Otherwise leave lib empty and set shape to box, cylinder, sheet, rod, tube, fastener or sphere.",
  "For every part give size_mm as [length, height, width] of one piece, at_mm as [x, y, z] for the center of one piece in the assembled object, and rot_deg as [x, y, z] rotation in degrees from the part's flat default. Library boards and drives lie flat by default, fans face up, screws point up. x runs along the object's length, y is height up from the floor, z runs across its width, origin at the center of the footprint on the floor. When there are several of the same part, put the other centers in more_at_mm, up to 12.",
  "size_from is spec when the size came from CONTEXT facts or a known standard, photo when you estimated it from the photo.",
  "model_url is a direct link to a free STL or GLB file of that exact part when CONTEXT gives one, otherwise empty.",
  "Give at most 40 parts. Count every fastener in qty.",
  "Write plain words with no dashes used as punctuation.",
  "Reply with JSON only, no other text, in this shape:",
  "{\"kind\":\"object\",\"name\":\"\",\"description\":\"\",\"confidence\":\"high\",\"notes\":\"\",\"vehicle\":\"\",\"car_id\":\"\",\"areas\":[\"\"],\"size_mm\":[0,0,0],\"groups\":[{\"name\":\"\",\"items\":[{\"name\":\"\",\"qty\":1,\"unit\":\"pcs\",\"spec\":\"\",\"thread\":\"\",\"torque\":\"\",\"part_number\":\"\",\"material\":\"\",\"purpose\":\"\",\"lib\":\"\",\"args\":{},\"shape\":\"box\",\"size_mm\":[0,0,0],\"at_mm\":[0,0,0],\"more_at_mm\":[],\"rot_deg\":[0,0,0],\"size_from\":\"photo\",\"model_url\":\"\"}]}]}"
].join("\n");

function hvStr(v, n) { return String(v == null ? "" : v).replace(/[–—]/g, " ").slice(0, n); }
function hvVec(v, lo, hi) {
  const a = Array.isArray(v) ? v : [];
  return [0, 1, 2].map((i) => { const x = Number(a[i]); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0; });
}
function hvJson(raw) {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { return null; }
}
function hvImages(body) {
  const out = [];
  [body.image, body.image2].forEach((img) => {
    img = String(img || "");
    if (/^[A-Za-z0-9+/=]{100,6000000}$/.test(img)) out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } });
  });
  return out;
}
function hvUrl(u) { u = String(u || ""); return /^https:\/\/[^\s"<>]{4,400}$/.test(u) ? u : ""; }
function hvIdentifyUser(body) {
  const parts = hvImages(body);
  parts.push({ type: "text", text: (parts.length > 1 ? "The second photo shows the label. " : "") + "Identify this and search for its specs and service manual." });
  return parts;
}
function hvIdentifyClean(raw) {
  const j = hvJson(raw);
  if (!j) return { error: "identify unreadable" };
  return {
    kind: j.kind === "car" ? "car" : "object",
    name: hvStr(j.name, 80), maker: hvStr(j.maker, 60), exact_model: hvStr(j.exact_model, 80),
    confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "medium",
    need_label: j.need_label === true, label_hint: hvStr(j.label_hint, 200),
    sources: (Array.isArray(j.sources) ? j.sources : []).slice(0, 8).map((x) => ({ title: hvStr(x && x.title, 100), url: hvUrl(x && x.url) })).filter((x) => x.url),
    facts: (Array.isArray(j.facts) ? j.facts : []).slice(0, 40).map((f) => hvStr(f, 200)).filter(Boolean)
  };
}
function hvUser(body) {
  const cars = (Array.isArray(body.cars) ? body.cars : []).slice(0, 60)
    .filter((c) => c && /^[a-z0-9_]{1,30}$/.test(String(c.id)))
    .map((c) => c.id + " = " + hvStr(c.name, 60));
  const parts = hvImages(body);
  let ctx = "";
  if (body.context && typeof body.context === "object") {
    const c = hvIdentifyClean(JSON.stringify(Object.assign({}, body.context, { facts: [] })));
    c.facts = (Array.isArray(body.context.facts) ? body.context.facts : []).slice(0, 160).map((f) => hvStr(f, 240)).filter(Boolean);
    ctx = hvStr(JSON.stringify(c), 24000);
  }
  parts.push({ type: "text", text: "CARS: " + (cars.join("; ") || "none") + "\nCONTEXT: " + (ctx || "none") + "\nScan this photo." });
  return parts;
}
function hvClean(raw) {
  const j = hvJson(raw);
  if (!j) return { error: "scan unreadable" };
  const out = {
    kind: j.kind === "car" ? "car" : "object",
    name: hvStr(j.name, 80) || "Scanned object",
    description: hvStr(j.description, 300),
    confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "medium",
    notes: hvStr(j.notes, 400),
    vehicle: hvStr(j.vehicle, 80),
    car_id: /^[a-z0-9_]{1,30}$/.test(String(j.car_id || "")) ? j.car_id : "",
    areas: (Array.isArray(j.areas) ? j.areas : []).slice(0, 8).map((a) => hvStr(a, 40)),
    size_mm: hvVec(j.size_mm, 1, 30000),
    groups: []
  };
  let count = 0;
  for (const g of (Array.isArray(j.groups) ? j.groups : []).slice(0, 10)) {
    const items = [];
    for (const it of (g && Array.isArray(g.items) ? g.items : [])) {
      if (count >= 40 || !it) break;
      count++;
      const args = {};
      if (it.args && typeof it.args === "object") {
        for (const k of ["length_mm", "slots", "size_mm", "height_mm", "diameter_mm"]) { const x = Number(it.args[k]); if (Number.isFinite(x) && x > 0 && x < 5000) args[k] = x; }
        if (["pan", "flat", "hex", "button"].includes(it.args.head)) args.head = it.args.head;
      }
      items.push({
        name: hvStr(it.name, 50) || "Part",
        qty: hvStr(it.qty, 12) || "1",
        unit: hvStr(it.unit, 12),
        spec: hvStr(it.spec, 160),
        thread: hvStr(it.thread, 40),
        torque: hvStr(it.torque, 40),
        part_number: hvStr(it.part_number, 40),
        material: hvStr(it.material, 60),
        purpose: hvStr(it.purpose, 80),
        lib: HV_LIB_KEYS.includes(it.lib) ? it.lib : "",
        args,
        shape: HV_SHAPES.includes(it.shape) ? it.shape : "box",
        size_mm: hvVec(it.size_mm, 1, 30000),
        at_mm: hvVec(it.at_mm, -30000, 30000),
        more_at_mm: (Array.isArray(it.more_at_mm) ? it.more_at_mm : []).slice(0, 12).map((v) => hvVec(v, -30000, 30000)),
        rot_deg: hvVec(it.rot_deg, -360, 360),
        size_from: it.size_from === "spec" ? "spec" : "photo",
        model_url: /\.(stl|glb)(\?|$)/i.test(String(it.model_url || "")) ? hvUrl(it.model_url) : ""
      });
    }
    if (items.length) out.groups.push({ name: hvStr(g.name, 40) || "Parts", items });
  }
  return out;
}

// Only documents the Hub View worker stored in the shared Supabase bucket may be sent to the AI.
const HV_DOC_HOST = /^https:\/\/zasyjjoypkpvyqdueums\.supabase\.co\/storage\/v1\/object\/public\/hv-files\/[A-Za-z0-9_./-]{3,200}\.pdf$/;
const HV_MANUALS = [
  "You find downloadable manuals for Hub View, a 3D exploded view parts app.",
  "Given an exact product, use web search to find direct links to PDF files from the manufacturer or a trustworthy archive: the service manual, maintenance and service guide, illustrated parts catalog, disassembly guide, quick specs or spec sheet.",
  "Only list links that point straight at a PDF file. Prefer the manufacturer's own site.",
  "Reply with JSON only, no other text: {\"pdfs\":[{\"title\":\"\",\"url\":\"\"}]} with at most 6 links."
].join("\n");
const HV_EXTRACT = [
  "You read manuals for Hub View, a 3D exploded view parts app.",
  "You get pages from a service manual or spec sheet for one exact product. Pull out every hard fact needed to rebuild it as an exploded 3D parts model.",
  "facts: short lines with overall dimensions, component sizes, form factors, screw sizes, threads and counts, torque values, part numbers and how parts mount to each other.",
  "parts: every component and fastener with its name, spare part_number, qty, size_mm as [length, height, width] when the pages give it, and the page number it came from.",
  "diagram_pages: page numbers in this document that show exploded views, component locations, disassembly drawings or parts illustrations.",
  "Never invent a number the pages do not give. Write plain words with no dashes used as punctuation.",
  "Reply with JSON only, no other text: {\"overall_size_mm\":[0,0,0],\"facts\":[\"\"],\"parts\":[{\"name\":\"\",\"part_number\":\"\",\"qty\":\"\",\"size_mm\":[0,0,0],\"page\":0}],\"diagram_pages\":[0]}"
].join("\n");
const HV_VERIFY = [
  "You fact check Hub View builds. A build is a parts list with sizes and positions that becomes an exploded 3D model of one exact product.",
  "You get the build, the facts and parts pulled from the product's manual, and the results of automatic geometry checks.",
  "Check every part: does its name, part number, size, count and thread agree with the manual facts? Does it fit inside the product and sit in a believable place? Is any part in the manual missing from the build?",
  "verdict is pass only when nothing important disagrees with the sources and no major part is missing. Otherwise verdict is flag.",
  "Write plain words with no dashes used as punctuation.",
  "Reply with JSON only, no other text: {\"verdict\":\"pass\",\"summary\":\"\",\"checks\":[{\"part\":\"\",\"ok\":true,\"note\":\"\"}],\"missing\":[\"\"]}"
].join("\n");
function hvList(v, n, len) { return (Array.isArray(v) ? v : []).slice(0, n).map((x) => hvStr(x, len)).filter(Boolean); }
function hvManualsClean(raw) {
  const j = hvJson(raw) || {};
  return { pdfs: (Array.isArray(j.pdfs) ? j.pdfs : []).slice(0, 6).map((x) => ({ title: hvStr(x && x.title, 120), url: hvUrl(x && x.url) })).filter((x) => x.url) };
}
function hvExtractUser(body) {
  const docs = (Array.isArray(body.docs) ? body.docs : []).filter((u) => HV_DOC_HOST.test(String(u))).slice(0, 2);
  const parts = docs.map((u) => ({ type: "document", source: { type: "url", url: u } }));
  parts.push({ type: "text", text: "PRODUCT: " + hvStr(body.product, 160) + "\nRead these pages and pull out the facts." });
  return parts;
}
function hvExtractClean(raw) {
  const j = hvJson(raw);
  if (!j) return { error: "extract unreadable" };
  return {
    overall_size_mm: hvVec(j.overall_size_mm, 0, 30000),
    facts: hvList(j.facts, 160, 240),
    parts: (Array.isArray(j.parts) ? j.parts : []).slice(0, 120).map((p) => ({
      name: hvStr(p && p.name, 80), part_number: hvStr(p && p.part_number, 40), qty: hvStr(p && p.qty, 12),
      size_mm: hvVec(p && p.size_mm, 0, 30000), page: Math.max(0, Math.min(5000, parseInt(p && p.page, 10) || 0))
    })).filter((p) => p.name),
    diagram_pages: (Array.isArray(j.diagram_pages) ? j.diagram_pages : []).map((n) => parseInt(n, 10)).filter((n) => n > 0 && n < 5000).slice(0, 30)
  };
}
function hvVerifyUser(body) {
  return [{ type: "text", text: "BUILD: " + hvStr(JSON.stringify(body.build || {}), 60000) + "\n\nMANUAL: " + hvStr(JSON.stringify(body.manual || {}), 40000) + "\n\nGEOMETRY CHECKS: " + hvStr(JSON.stringify(body.geometry || []), 8000) }];
}
function hvVerifyClean(raw) {
  const j = hvJson(raw);
  if (!j) return { error: "verify unreadable" };
  return {
    verdict: j.verdict === "pass" ? "pass" : "flag",
    summary: hvStr(j.summary, 500),
    checks: (Array.isArray(j.checks) ? j.checks : []).slice(0, 80).map((c) => ({ part: hvStr(c && c.part, 80), ok: !!(c && c.ok), note: hvStr(c && c.note, 200) })),
    missing: hvList(j.missing, 40, 120)
  };
}

module.exports = {
  "hubview-identify": {
    model: "claude-sonnet-5-5",
    maxTokens: 2000,
    system: HV_IDENTIFY,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    buildUser: hvIdentifyUser,
    finish: hvIdentifyClean
  },
  "hubview-manuals": {
    model: "claude-sonnet-5-5",
    maxTokens: 1500,
    system: HV_MANUALS,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    buildUser: (body) => "PRODUCT: " + hvStr(body.product, 160) + "\nFind direct PDF links for its manuals.",
    finish: hvManualsClean
  },
  "hubview-extract": {
    model: "claude-sonnet-5-5",
    maxTokens: 8000,
    system: HV_EXTRACT,
    buildUser: hvExtractUser,
    finish: hvExtractClean
  },
  "hubview-verify": {
    model: "claude-sonnet-5-5",
    maxTokens: 5000,
    system: HV_VERIFY,
    buildUser: hvVerifyUser,
    finish: hvVerifyClean
  },
  "hubview-scan": {
    model: "claude-sonnet-5-5",
    maxTokens: 8000,
    system: HV_SYSTEM,
    buildUser: hvUser,
    finish: hvClean
  },
  "heckle-troll-roast": {
    model: "claude-sonnet-5-5",
    maxTokens: 1800,
    system: HECKLE_VOICE.concat(["You are reviewing one whole web app from a solo developer's repo."], HECKLE_WORK).join(" "),
    buildUser: heckleText(150000)
  },
  "heckle-troll-push": {
    model: "claude-sonnet-5-5",
    maxTokens: 1200,
    system: HECKLE_VOICE.concat(["You are reviewing one push to a solo developer's repo: the commit messages and the diff."], HECKLE_WORK).join(" "),
    buildUser: heckleText(100000)
  },
  "heckle-troll-fleet": {
    model: "claude-sonnet-5-5",
    maxTokens: 2200,
    system: HECKLE_VOICE.concat([
      "You are looking at a whole fleet of one developer's repos at once.",
      "Find the clones: groups of repos that are the same idea wearing different hats. Find the ones that should be merged into one app with a mode switch, the ones that look abandoned, and the few that are one of a kind and deserve more love.",
      "Only judge from the names, descriptions, page titles and page openings you were given. Never invent repos.",
      "Start with one paragraph of roast. Then a paragraph that begins with Merge these: naming each group. Then a paragraph that begins with Kill or finish these:. Then a paragraph that begins with Keep and polish these:."
    ]).join(" "),
    buildUser: heckleText(120000)
  },
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
