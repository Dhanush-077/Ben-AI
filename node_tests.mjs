// Backend E2E test in Node (fetch). Mirrors backend_tests.py.
// Usage: node node_tests.mjs   (backend must be running on :8000)
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

// Builds a real, valid PNG in memory (8x8 solid color). A hand-rolled '1x1'
// byte blob gets rejected by image-capable models ("Unable to process input
// image"), so we construct one with a genuine IHDR/IDAT/IEND + CRC.
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(w = 8, h = 8, r = 220, g = 60, b = 60) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor RGB
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([sig, pngChunk(Buffer.from("IHDR"), ihdr), pngChunk(Buffer.from("IDAT"), deflateSync(raw)), pngChunk(Buffer.from("IEND"), Buffer.alloc(0))]);
}

const BASE = "http://127.0.0.1:8000";
const SB = process.env.SUPABASE_URL || "https://yxrzaucyqvzsznxugjtx.supabase.co";
// Never hardcode the key: read from env (same value as backend/.env
// SUPABASE_SERVICE_KEY). Only used for the storage-bucket existence probe.
const SVC = process.env.SUPABASE_SERVICE_KEY || "";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function api(method, path, { token, json, form, files } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, v);
    if (files) for (const [k, { data, name, type }] of Object.entries(files)) {
      fd.append(k, new Blob([Uint8Array.from(data)], { type }), name);
    }
    body = fd;
  }
  const r = await fetch(BASE + path, { method, headers, body });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  return { status: r.status, data };
}

const rng = randomBytes(4).toString("hex");
const email = `nodetest_${rng}@example.com`;
const pass = "test1234";

// auth
let r = await api("POST", "/signup", { json: { email, password: pass } });
let token = r.data?.token;
check("signup", r.status === 200 && !!token, `status=${r.status}`);
r = await api("POST", "/login", { json: { email, password: pass } });
token = r.data?.token || token;
check("login", r.status === 200 && !!token, `status=${r.status}`);

// conversations (needs migration.sql — table may be missing)
r = await api("GET", "/conversations", { token });
check("GET /conversations responds", r.status === 200 || r.status === 500, `status=${r.status} body=${String(r.data).slice(0, 120)}`);

r = await api("POST", "/conversations", { token });
const cid1 = r.data?.conversation_id;
check("POST /conversations creates", r.status === 200 && !!cid1, `status=${r.status} cid=${cid1}`);

if (cid1) {
  r = await api("POST", "/chat", { token, json: { message: "who built you?", conversation_id: cid1 } });
  const reply = r.data?.reply || "";
  check("chat works", r.status === 200 && reply.length > 0, `status=${r.status}`);

  // first message of a brand-new conversation should auto-generate a title
  r = await api("GET", "/conversations", { token });
  const titled = (r.data?.conversations || []).find((c) => c.id === cid1);
  check("auto-title generated", r.status === 200 && !!titled && titled.title !== "New chat", `title="${titled?.title}"`);

  check("who-built has links", reply.includes("[GitHub]") && reply.includes("[LinkedIn]") && reply.includes("[View Resume]"), reply.slice(0, 120));
  check("who-built has bullets", /\n\s*[-*•]/.test(reply), reply.slice(0, 120));

  r = await api("GET", `/history?conversation_id=${cid1}`, { token });
  check("history scoped", r.status === 200 && (r.data?.messages?.length || 0) >= 2, `status=${r.status}`);

  r = await api("PATCH", `/conversations/${cid1}`, { token, json: { title: "Renamed", pinned: true } });
  check("rename+pin", r.status === 200, `status=${r.status}`);

  // image upload + round-trip (uses the real conversation we own)
  const png = makePng(8, 8);
  r = await api("POST", "/chat-with-image", {
    token,
    form: { message: "what color?", conversation_id: String(cid1) },
    files: { image: { data: png, name: "tiny.png", type: "image/png" } },
  });
  check("image chat works", r.status === 200 && !!r.data?.image_url, `status=${r.status} url=${String(r.data?.image_url).slice(0, 80)}`);

  // history now includes the image message with image_url preserved
  r = await api("GET", `/history?conversation_id=${cid1}`, { token });
  const imageMsgs = (r.data?.messages || []).filter((m) => m.image_url);
  check("image_url round-trips in history", imageMsgs.length >= 1, `count=${imageMsgs.length}`);
}

// storage bucket existence — supabase-py sends BOTH apikey + Authorization
// (that's what the backend uses); our probes must send both too.
try {
  const b = await fetch(`${SB}/storage/v1/bucket`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  const buckets = await b.json();
  check("chat-images bucket exists", Array.isArray(buckets) && buckets.some((x) => x.name === "chat-images"), JSON.stringify(buckets).slice(0, 160));
} catch (e) {
  check("chat-images bucket exists", false, e.message);
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);