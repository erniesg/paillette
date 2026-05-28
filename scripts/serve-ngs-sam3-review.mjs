#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT_DIR =
  "/Users/erniesg/Downloads/paillette-ngs-local-sam3-review";

const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);
const preferredPort = Number(args.port || 4177);
const resultsJsonl = path.join(outputDir, "sam3-review-results.jsonl");
const postcheckJson = path.join(outputDir, "sam3-review-postcheck.json");
const decisionsPath = path.join(outputDir, "sam3-review-decisions.json");

if (!fs.existsSync(resultsJsonl)) {
  console.error(`Missing results JSONL: ${resultsJsonl}`);
  process.exit(1);
}

const rows = readRows(resultsJsonl);
const postcheck = readPostcheck(postcheckJson);
const summary = summarize(rows);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, html(), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/results") {
      return sendJson(res, { summary, rows: rows.map(toClientRow) });
    }
    if (req.method === "GET" && url.pathname === "/api/decisions") {
      return sendJson(res, readDecisions());
    }
    if (req.method === "POST" && url.pathname === "/api/decisions") {
      const body = await readBody(req, 8 * 1024 * 1024);
      const parsed = JSON.parse(body || "{}");
      const payload = {
        updatedAt: new Date().toISOString(),
        sourceResults: resultsJsonl,
        decisions: parsed.decisions && typeof parsed.decisions === "object"
          ? parsed.decisions
          : {},
      };
      writeJsonAtomic(decisionsPath, payload);
      return sendJson(res, { ok: true, path: decisionsPath, updatedAt: payload.updatedAt });
    }
    if (req.method === "GET" && url.pathname.startsWith("/media/input/")) {
      const name = decodeURIComponent(url.pathname.slice("/media/input/".length));
      return sendFile(res, path.join(outputDir, "input", path.basename(name)));
    }
    if (req.method === "GET" && url.pathname.startsWith("/media/contact/")) {
      const name = decodeURIComponent(url.pathname.slice("/media/contact/".length));
      return sendFile(
        res,
        path.join(outputDir, "sam3-review-contact-sheets", path.basename(name)),
      );
    }
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    return send(
      res,
      500,
      error && error.stack ? error.stack : String(error),
      "text/plain; charset=utf-8",
    );
  }
});

listenWithFallback(server, preferredPort, 20);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") parsed.outputDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) parsed.outputDir = arg.slice(13);
    else if (arg === "--port") parsed.port = argv[++i];
    else if (arg.startsWith("--port=")) parsed.port = arg.slice(7);
  }
  return parsed;
}

function readRows(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readPostcheck(filePath) {
  if (!fs.existsSync(filePath)) return { summary: null, rows: {} };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    summary: parsed.summary || null,
    rows: parsed.rows || {},
  };
}

function summarize(allRows) {
  const actions = {};
  const priorities = {};
  const reasons = {};
  for (const row of allRows) {
    actions[row.action] = (actions[row.action] || 0) + 1;
    reasons[row.reason] = (reasons[row.reason] || 0) + 1;
    const priority = row.artwork?.sam3Priority || "unknown";
    priorities[priority] ||= { total: 0, crop: 0, keep: 0 };
    priorities[priority].total += 1;
    priorities[priority][row.action] = (priorities[priority][row.action] || 0) + 1;
  }
  return {
    total: allRows.length,
    crop: actions.crop || 0,
    keep: actions.keep || 0,
    actions,
    priorities,
    reasons,
    outputDir,
    resultsJsonl,
    postcheckJson,
    postcheck: postcheck.summary,
    decisionsPath,
  };
}

function toClientRow(row) {
  const [width, height] = row.full_size || [];
  const box = row.final_box || null;
  const metrics = boxMetrics(box, width, height);
  const flags = [];
  if (metrics) {
    if (metrics.area < 0.08) flags.push("small");
    if (metrics.aspect < 0.18) flags.push("thin");
    if (metrics.touchesEdge) flags.push("edge");
    if (metrics.area > 0.92) flags.push("near-full");
  }
  const score = row.selected?.score;
  if (typeof score === "number" && score < 0.25) flags.push("low-score");
  const edgePostcheck = postcheck.rows[row.name] || null;
  if (edgePostcheck?.recommendation === "likely_false_positive") flags.push("likely-fp");
  if (edgePostcheck?.recommendation === "likely_border_crop") flags.push("border-crop");
  if (edgePostcheck?.recommendation === "needs_review") flags.push("postcheck-review");
  for (const flag of edgePostcheck?.flags || []) flags.push(flag);
  if ((row.artwork?.reasons || []).includes("possible_color_card_or_calibration_target")) {
    flags.push("color-card-signal");
  }
  return {
    index: row.queue_index,
    name: row.name,
    action: row.action,
    reason: row.reason,
    priority: row.artwork?.sam3Priority || "unknown",
    artworkId: row.artwork?.artworkId || row.artwork?.accessionNumber || "",
    accessionNumber: row.artwork?.accessionNumber || "",
    title: row.artwork?.title || "",
    artist: row.artwork?.artist || "",
    classification: row.artwork?.classification || "",
    medium: row.artwork?.medium || "",
    dateText: row.artwork?.dateText || "",
    sourceUrl: row.artwork?.sourceUrl || "",
    reasons: row.artwork?.reasons || [],
    width,
    height,
    box,
    selectedBox: row.selected?.box || null,
    score: typeof score === "number" ? score : null,
    prompt: row.selected?.prompt || "",
    metrics,
    postcheck: edgePostcheck,
    flags,
  };
}

function boxMetrics(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !width || !height) return null;
  const boxWidth = Math.max(0, box[2] - box[0]);
  const boxHeight = Math.max(0, box[3] - box[1]);
  const area = (boxWidth * boxHeight) / (width * height);
  const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight || 1);
  const touchesEdge =
    box[0] <= 2 || box[1] <= 2 || box[2] >= width - 2 || box[3] >= height - 2;
  return {
    boxWidth,
    boxHeight,
    area: Number(area.toFixed(4)),
    aspect: Number(aspect.toFixed(4)),
    touchesEdge,
  };
}

function readDecisions() {
  if (!fs.existsSync(decisionsPath)) {
    return { updatedAt: null, sourceResults: resultsJsonl, decisions: {} };
  }
  return JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, value) {
  return send(res, 200, JSON.stringify(value), "application/json; charset=utf-8");
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === ".webp" ? "image/webp" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".png" ? "image/png" :
    "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
}

function listenWithFallback(app, port, attemptsLeft) {
  app.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listenWithFallback(app, port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });
  app.listen(port, "127.0.0.1", () => {
    const address = app.address();
    console.log(`NGS SAM3 review page: http://127.0.0.1:${address.port}/`);
    console.log(`Decisions file: ${decisionsPath}`);
  });
}

function html() {
  const thisFile = fileURLToPath(import.meta.url);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NGS SAM3 Review</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #151922;
      --muted: #667085;
      --accent: #315eb8;
      --accept: #1f7a4d;
      --reject: #b42318;
      --unsure: #9a6700;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(255,255,255,.96);
      border-bottom: 1px solid var(--line);
      padding: 12px 18px;
      backdrop-filter: blur(8px);
    }
    .topline, .filters, .pager {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .topline { justify-content: space-between; margin-bottom: 10px; }
    h1 { font-size: 18px; line-height: 1.2; margin: 0; font-weight: 650; }
    .stats { color: var(--muted); font-size: 13px; }
    main { padding: 16px 18px 40px; }
    input, select, button, textarea {
      font: inherit;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: white;
      color: var(--text);
    }
    input, select { height: 34px; padding: 0 10px; }
    input[type="search"] { width: min(380px, 100%); }
    button {
      height: 34px;
      padding: 0 11px;
      cursor: pointer;
    }
    button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    button.accept { color: var(--accept); border-color: rgba(31,122,77,.35); }
    button.reject { color: var(--reject); border-color: rgba(180,35,24,.35); }
    button.unsure { color: var(--unsure); border-color: rgba(154,103,0,.35); }
    button.active.accept { background: #e7f6ee; border-color: var(--accept); }
    button.active.reject { background: #fde8e7; border-color: var(--reject); }
    button.active.unsure { background: #fff3d6; border-color: var(--unsure); }
    .pager { margin-top: 10px; justify-content: space-between; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .card[data-decision="accept"] { border-color: rgba(31,122,77,.65); }
    .card[data-decision="reject"] { border-color: rgba(180,35,24,.65); }
    .card[data-decision="unsure"] { border-color: rgba(154,103,0,.65); }
    .card-head {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 3px;
    }
    .title {
      font-size: 14px;
      font-weight: 650;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .meta, .flags {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .flag {
      display: inline-block;
      padding: 1px 6px;
      border: 1px solid #f2c94c;
      background: #fff8db;
      border-radius: 999px;
      margin-right: 4px;
      color: #7a5600;
    }
    .media {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 10px 12px 6px;
      align-items: start;
    }
    .pane {
      min-height: 245px;
      display: grid;
      align-content: start;
      justify-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    canvas {
      max-width: 100%;
      height: auto;
      background: #f3f4f6;
      border: 1px solid #edf0f4;
    }
    .actions {
      display: flex;
      gap: 8px;
      padding: 8px 12px 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    textarea {
      width: 100%;
      min-height: 34px;
      resize: vertical;
      padding: 7px 9px;
    }
    .empty {
      padding: 40px;
      text-align: center;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      main, header { padding-left: 10px; padding-right: 10px; }
      .grid { grid-template-columns: 1fr; }
      .media { grid-template-columns: 1fr; }
      input[type="search"] { width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <h1>NGS SAM3 Review</h1>
      <div class="stats" id="stats">Loading</div>
    </div>
    <div class="filters">
      <input id="search" type="search" placeholder="Search accession, title, artist, filename" />
      <select id="action">
        <option value="crop">Crop candidates</option>
        <option value="keep">Keeps</option>
        <option value="all">All routed rows</option>
      </select>
      <select id="recommendation">
        <option value="reviewable">Reviewable crops</option>
        <option value="likely_border_crop">Likely border crops</option>
        <option value="needs_review">Ambiguous crops</option>
        <option value="likely_false_positive">Likely false positives</option>
        <option value="all">All recommendations</option>
      </select>
      <select id="priority">
        <option value="all">All priorities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select id="flag">
        <option value="all">All flags</option>
        <option value="flagged">Any flag</option>
        <option value="small">Small</option>
        <option value="thin">Thin</option>
        <option value="edge">Edge</option>
        <option value="low-score">Low score</option>
        <option value="near-full">Near full</option>
        <option value="color-card-signal">Color-card signal</option>
        <option value="discarded_content">Discarded content</option>
        <option value="discarded_artwork_surface">Discarded surface</option>
      </select>
      <select id="decision">
        <option value="all">All decisions</option>
        <option value="none">Undecided</option>
        <option value="accept">Accepted</option>
        <option value="reject">Rejected</option>
        <option value="unsure">Unsure</option>
      </select>
      <select id="sort">
        <option value="recommendation">Recommendation</option>
        <option value="queue">Queue order</option>
        <option value="priority">Priority</option>
        <option value="area-asc">Area asc</option>
        <option value="area-desc">Area desc</option>
        <option value="score-asc">Score asc</option>
        <option value="score-desc">Score desc</option>
      </select>
      <button id="save" class="primary">Save</button>
      <button id="export">Export</button>
    </div>
    <div class="pager">
      <div>
        <button id="prev">Prev</button>
        <button id="next">Next</button>
      </div>
      <div class="stats" id="pageInfo"></div>
      <div>
        <button id="rejectLikelyFp" class="reject">Reject Likely FP</button>
        <button id="rejectVisible" class="reject">Reject Visible</button>
        <button id="clearVisible">Clear Visible</button>
      </div>
    </div>
  </header>
  <main>
    <div id="grid" class="grid"></div>
  </main>
  <script>
    const pageSize = 40;
    const state = {
      rows: [],
      filtered: [],
      decisions: {},
      page: 0,
      dirty: false,
      saving: false,
    };
    const priorityWeight = { high: 0, medium: 1, low: 2, unknown: 3 };
    const recommendationWeight = { likely_border_crop: 0, needs_review: 1, likely_false_positive: 2, none: 3 };

    const els = {
      stats: document.getElementById("stats"),
      search: document.getElementById("search"),
      action: document.getElementById("action"),
      recommendation: document.getElementById("recommendation"),
      priority: document.getElementById("priority"),
      flag: document.getElementById("flag"),
      decision: document.getElementById("decision"),
      sort: document.getElementById("sort"),
      save: document.getElementById("save"),
      export: document.getElementById("export"),
      prev: document.getElementById("prev"),
      next: document.getElementById("next"),
      pageInfo: document.getElementById("pageInfo"),
      grid: document.getElementById("grid"),
      rejectLikelyFp: document.getElementById("rejectLikelyFp"),
      rejectVisible: document.getElementById("rejectVisible"),
      clearVisible: document.getElementById("clearVisible"),
    };

    init();

    async function init() {
      const [results, saved] = await Promise.all([
        fetch("/api/results").then((r) => r.json()),
        fetch("/api/decisions").then((r) => r.json()),
      ]);
      state.rows = results.rows;
      state.decisions = saved.decisions || {};
      const post = results.summary.postcheck?.recommendations || {};
      els.stats.textContent =
        \`\${results.summary.crop} crop, \${results.summary.keep} keep, \${results.summary.total} total · \${post.likely_false_positive || 0} likely FP, \${post.likely_border_crop || 0} likely border, \${post.needs_review || 0} ambiguous\`;
      bind();
      applyFilters();
    }

    function bind() {
      for (const el of [els.search, els.action, els.recommendation, els.priority, els.flag, els.decision, els.sort]) {
        el.addEventListener("input", () => {
          state.page = 0;
          applyFilters();
        });
      }
      els.prev.addEventListener("click", () => {
        state.page = Math.max(0, state.page - 1);
        render();
      });
      els.next.addEventListener("click", () => {
        const maxPage = Math.max(0, Math.ceil(state.filtered.length / pageSize) - 1);
        state.page = Math.min(maxPage, state.page + 1);
        render();
      });
      els.save.addEventListener("click", () => saveDecisions());
      els.export.addEventListener("click", exportDecisions);
      els.rejectLikelyFp.addEventListener("click", rejectLikelyFalsePositives);
      els.rejectVisible.addEventListener("click", () => setVisible("reject"));
      els.clearVisible.addEventListener("click", () => setVisible(null));
    }

    function applyFilters() {
      const query = els.search.value.trim().toLowerCase();
      const action = els.action.value;
      const recommendation = els.recommendation.value;
      const priority = els.priority.value;
      const flag = els.flag.value;
      const decision = els.decision.value;
      state.filtered = state.rows.filter((row) => {
        if (action !== "all" && row.action !== action) return false;
        const rec = row.postcheck?.recommendation || "none";
        if (recommendation === "reviewable" && rec !== "likely_border_crop" && rec !== "needs_review") return false;
        if (recommendation !== "all" && recommendation !== "reviewable" && rec !== recommendation) return false;
        if (priority !== "all" && row.priority !== priority) return false;
        if (flag === "flagged" && !row.flags.length) return false;
        if (flag !== "all" && flag !== "flagged" && !row.flags.includes(flag)) return false;
        const currentDecision = state.decisions[row.name]?.decision || "none";
        if (decision !== "all" && currentDecision !== decision) return false;
        if (query) {
          const haystack = [
            row.name,
            row.artworkId,
            row.accessionNumber,
            row.title,
            row.artist,
            row.reason,
            row.classification,
            row.medium,
          ].join(" ").toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });
      sortRows(state.filtered, els.sort.value);
      render();
    }

    function sortRows(rows, mode) {
      rows.sort((a, b) => {
        if (mode === "recommendation") {
          return (
            (recommendationWeight[a.postcheck?.recommendation || "none"] ?? 9) -
              (recommendationWeight[b.postcheck?.recommendation || "none"] ?? 9) ||
            a.index - b.index
          );
        }
        if (mode === "priority") {
          return (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9) || a.index - b.index;
        }
        if (mode === "area-asc") return metric(a, "area") - metric(b, "area") || a.index - b.index;
        if (mode === "area-desc") return metric(b, "area") - metric(a, "area") || a.index - b.index;
        if (mode === "score-asc") return score(a) - score(b) || a.index - b.index;
        if (mode === "score-desc") return score(b) - score(a) || a.index - b.index;
        return a.index - b.index;
      });
    }

    function metric(row, key) {
      return row.metrics?.[key] ?? Number.POSITIVE_INFINITY;
    }

    function score(row) {
      return row.score ?? -1;
    }

    function render() {
      const maxPage = Math.max(0, Math.ceil(state.filtered.length / pageSize) - 1);
      state.page = Math.min(state.page, maxPage);
      const start = state.page * pageSize;
      const visible = state.filtered.slice(start, start + pageSize);
      els.pageInfo.textContent =
        \`\${state.filtered.length} rows · page \${state.page + 1}/\${maxPage + 1}\`;
      els.prev.disabled = state.page === 0;
      els.next.disabled = state.page >= maxPage;
      if (!visible.length) {
        els.grid.innerHTML = '<div class="empty">No rows</div>';
        return;
      }
      els.grid.innerHTML = visible.map(cardHtml).join("");
      for (const row of visible) drawRow(row);
      for (const button of els.grid.querySelectorAll("[data-set-decision]")) {
        button.addEventListener("click", () => setDecision(button.dataset.name, button.dataset.setDecision || null));
      }
      for (const textarea of els.grid.querySelectorAll("textarea")) {
        textarea.addEventListener("input", () => setNote(textarea.dataset.name, textarea.value));
      }
    }

    function cardHtml(row) {
      const d = state.decisions[row.name]?.decision || "none";
      const note = escapeHtml(state.decisions[row.name]?.note || "");
      const flags = row.flags.length
        ? row.flags.map((flag) => \`<span class="flag">\${escapeHtml(flag)}</span>\`).join("")
        : "";
      const area = row.metrics ? Math.round(row.metrics.area * 1000) / 10 : "";
      const score = row.score == null ? "" : row.score.toFixed(3);
      const rec = row.postcheck?.recommendation || "none";
      const rationale = row.postcheck?.rationale || "";
      return \`
        <section class="card" data-decision="\${d === "none" ? "" : d}">
          <div class="card-head">
            <div class="title">\${escapeHtml(row.index + ". " + row.name)}</div>
            <div class="meta">\${escapeHtml(row.title || "Untitled")} · \${escapeHtml(row.artist || "Unknown artist")}</div>
            <div class="meta">\${escapeHtml(row.priority)} · \${escapeHtml(row.reason)} · area \${area}% · score \${score}</div>
            <div class="meta">\${escapeHtml(recommendationLabel(rec))}\${rationale ? " · " + escapeHtml(rationale) : ""}</div>
            <div class="flags">\${flags}</div>
          </div>
          <div class="media">
            <div class="pane"><span>original</span><canvas data-original="\${escapeHtml(row.name)}"></canvas></div>
            <div class="pane"><span>selected</span><canvas data-crop="\${escapeHtml(row.name)}"></canvas></div>
          </div>
          <div class="actions">
            <button class="accept \${d === "accept" ? "active" : ""}" data-name="\${escapeHtml(row.name)}" data-set-decision="accept">Accept</button>
            <button class="reject \${d === "reject" ? "active" : ""}" data-name="\${escapeHtml(row.name)}" data-set-decision="reject">Reject</button>
            <button class="unsure \${d === "unsure" ? "active" : ""}" data-name="\${escapeHtml(row.name)}" data-set-decision="unsure">Unsure</button>
            <button data-name="\${escapeHtml(row.name)}" data-set-decision="">Clear</button>
            \${row.sourceUrl ? \`<a href="\${escapeAttr(row.sourceUrl)}" target="_blank" rel="noreferrer">source</a>\` : ""}
            <textarea data-name="\${escapeHtml(row.name)}" placeholder="Note">\${note}</textarea>
          </div>
        </section>\`;
    }

    function recommendationLabel(value) {
      if (value === "likely_false_positive") return "Likely false positive";
      if (value === "likely_border_crop") return "Likely border crop";
      if (value === "needs_review") return "Ambiguous crop";
      return "No post-check";
    }

    function drawRow(row) {
      const original = els.grid.querySelector(\`canvas[data-original="\${cssEscape(row.name)}"]\`);
      const crop = els.grid.querySelector(\`canvas[data-crop="\${cssEscape(row.name)}"]\`);
      const img = new Image();
      img.onload = () => {
        drawOriginal(original, img, row);
        drawCrop(crop, img, row);
      };
      img.src = \`/media/input/\${encodeURIComponent(row.name)}\`;
    }

    function drawOriginal(canvas, img, row) {
      const width = row.width || img.naturalWidth;
      const height = row.height || img.naturalHeight;
      const scale = Math.min(300 / width, 235 / height, 1);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (row.box) {
        const x = row.box[0] * scale;
        const y = row.box[1] * scale;
        const w = (row.box[2] - row.box[0]) * scale;
        const h = (row.box[3] - row.box[1]) * scale;
        ctx.fillStyle = "rgba(180, 35, 24, 0.22)";
        ctx.fillRect(0, 0, canvas.width, y);
        ctx.fillRect(0, y + h, canvas.width, Math.max(0, canvas.height - y - h));
        ctx.fillRect(0, y, x, h);
        ctx.fillRect(x + w, y, Math.max(0, canvas.width - x - w), h);
        ctx.strokeStyle = "#ff00c8";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
      }
      if (row.selectedBox && row.action === "crop") {
        ctx.strokeStyle = "#00b8d9";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          row.selectedBox[0] * scale,
          row.selectedBox[1] * scale,
          (row.selectedBox[2] - row.selectedBox[0]) * scale,
          (row.selectedBox[3] - row.selectedBox[1]) * scale,
        );
      }
    }

    function drawCrop(canvas, img, row) {
      const box = row.action === "crop" && row.box ? row.box : [0, 0, row.width, row.height];
      const sx = box[0];
      const sy = box[1];
      const sw = Math.max(1, box[2] - box[0]);
      const sh = Math.max(1, box[3] - box[1]);
      const scale = Math.min(300 / sw, 235 / sh, 2);
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }

    function setDecision(name, decision) {
      state.decisions[name] ||= {};
      if (!decision) {
        delete state.decisions[name].decision;
        if (!state.decisions[name].note) delete state.decisions[name];
      } else {
        state.decisions[name] = {
          ...state.decisions[name],
          decision,
          updatedAt: new Date().toISOString(),
        };
      }
      state.dirty = true;
      render();
      saveDecisionsDebounced();
    }

    function setNote(name, note) {
      state.decisions[name] ||= {};
      state.decisions[name].note = note;
      state.decisions[name].updatedAt = new Date().toISOString();
      if (!state.decisions[name].decision && !note) delete state.decisions[name];
      state.dirty = true;
      saveDecisionsDebounced();
    }

    function visibleRows() {
      const start = state.page * pageSize;
      return state.filtered.slice(start, start + pageSize);
    }

    function setVisible(decision) {
      for (const row of visibleRows()) {
        state.decisions[row.name] ||= {};
        if (decision) state.decisions[row.name].decision = decision;
        else if (state.decisions[row.name]) delete state.decisions[row.name].decision;
        if (!state.decisions[row.name].decision && !state.decisions[row.name].note) delete state.decisions[row.name];
      }
      state.dirty = true;
      render();
      saveDecisionsDebounced();
    }

    function rejectLikelyFalsePositives() {
      for (const row of state.rows) {
        if (row.postcheck?.recommendation !== "likely_false_positive") continue;
        state.decisions[row.name] = {
          ...state.decisions[row.name],
          decision: "reject",
          updatedAt: new Date().toISOString(),
        };
      }
      state.dirty = true;
      applyFilters();
      saveDecisionsDebounced();
    }

    let saveTimer = null;
    function saveDecisionsDebounced() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDecisions, 600);
    }

    async function saveDecisions() {
      if (state.saving) return;
      state.saving = true;
      els.save.textContent = "Saving";
      await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions: state.decisions }),
      });
      state.dirty = false;
      state.saving = false;
      els.save.textContent = "Save";
    }

    function exportDecisions() {
      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        source: ${JSON.stringify(thisFile)},
        decisions: state.decisions,
      }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sam3-review-decisions.json";
      link.click();
      URL.revokeObjectURL(url);
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function escapeAttr(value) {
      return escapeHtml(value).replaceAll("'", "&#39;");
    }

    function cssEscape(value) {
      return CSS.escape(value);
    }
  </script>
</body>
</html>`;
}
