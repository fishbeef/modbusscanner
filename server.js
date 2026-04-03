/**
 * Modbus TCP Scanner – WebSocket + HTTP server
 *
 * Serves index.html and bridges WebSocket messages to Modbus TCP.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Server:
 *     { type: "scan",          id, ip, port, unitId, regType, startReg, count, batchSize }
 *     { type: "scan_yaml",     id, ip, port, unitId }
 *     { type: "scan_discover", id, ip, port, unitId }
 *     { type: "get_config" }
 *     { type: "cancel",        id }
 *
 *   Server → Client:
 *     { type: "config",    registers: [...] }
 *     { type: "result",    id, register, name, value, raw, scaledValue, unit, dataType, sanity }
 *     { type: "progress",  id, done, total, phase }
 *     { type: "done",      id }
 *     { type: "error",     id, message }
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const ModbusRTU = require("modbus-serial");
const yaml = require("js-yaml");

const HTTP_PORT = process.env.PORT || 8080;

// ── Load YAML register definitions ───────────────────────────────────────────
let yamlRegisters = []; // flat list of parsed sensor definitions

function loadYamlConfig() {
  const yamlPath = path.join(__dirname, "modbus.yaml");
  if (!fs.existsSync(yamlPath)) {
    console.warn("modbus.yaml not found – YAML scan mode unavailable");
    return;
  }
  try {
    const raw = fs.readFileSync(yamlPath, "utf8");
    const docs = yaml.load(raw);

    // The YAML is a list; take the first entry's sensors array
    const device = Array.isArray(docs) ? docs[0] : docs;
    const sensors = device?.sensors || [];

    // Derive section name from register name prefix (e.g. "EU13L_Hp1_..." → "Heat Pump 1")
    yamlRegisters = sensors.map((s) => ({
      name: s.name,
      address: Number(s.address),
      input_type: s.input_type || "holding",
      data_type: s.data_type || "uint16",
      scale: s.scale != null ? Number(s.scale) : 1,
      precision: s.precision != null ? Number(s.precision) : 0,
      unit: s.unit_of_measurement || "",
      section: deriveSection(s.name),
    }));

    console.log(`Loaded ${yamlRegisters.length} register definitions from modbus.yaml`);
  } catch (err) {
    console.error("Failed to parse modbus.yaml:", err.message);
  }
}

function deriveSection(name) {
  if (/_(Ambient|ambient)_/i.test(name))    return "Ambient";
  if (/_(EMgr|emgr)_/i.test(name))          return "E-Manager";
  if (/_Hp(\d+)_/i.test(name))              return "Heat Pump " + name.match(/_Hp(\d+)_/i)[1];
  if (/_Boil(\d+)_/i.test(name))            return "Boiler " + name.match(/_Boil(\d+)_/i)[1];
  if (/_Buff(\d+)_/i.test(name))            return "Buffer " + name.match(/_Buff(\d+)_/i)[1];
  if (/_Sol(\d+)_/i.test(name))             return "Solar " + name.match(/_Sol(\d+)_/i)[1];
  if (/_Hc(\d+)_/i.test(name))             return "Heating Circuit " + name.match(/_Hc(\d+)_/i)[1];
  return "Other";
}

loadYamlConfig();

// ── HTTP server ──────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("index.html not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const activeSessions = new Map(); // id → { cancelled: bool }

  // Send YAML register config immediately on connect
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "config", registers: yamlRegisters }));
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "scan") {
      handleScan(ws, msg, activeSessions);
    } else if (msg.type === "scan_yaml") {
      handleScanYaml(ws, msg, activeSessions);
    } else if (msg.type === "scan_discover") {
      handleDiscover(ws, msg, activeSessions);
    } else if (msg.type === "get_config") {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "config", registers: yamlRegisters }));
      }
    } else if (msg.type === "cancel") {
      const sess = activeSessions.get(msg.id);
      if (sess) sess.cancelled = true;
    }
  });

  ws.on("close", () => {
    for (const sess of activeSessions.values()) {
      sess.cancelled = true;
    }
  });
});

// ── Raw range scan handler ────────────────────────────────────────────────────
async function handleScan(ws, msg, activeSessions) {
  const { id, ip, port, unitId, regType, startReg, count, batchSize } = msg;
  const session = { cancelled: false };
  activeSessions.set(id, session);

  const client = new ModbusRTU();
  client.setTimeout(3000);

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ ...obj, id }));
  };

  try {
    await client.connectTCP(ip, { port: Number(port) || 502 });
    client.setID(Number(unitId) || 1);
  } catch (err) {
    send({ type: "error", message: `Connection failed: ${err.message}` });
    activeSessions.delete(id);
    return;
  }

  const total = Number(count) || 100;
  const batch = Math.min(Number(batchSize) || 10, 125); // Modbus max is 125
  let done = 0;

  try {
    for (let offset = 0; offset < total && !session.cancelled; offset += batch) {
      const qty = Math.min(batch, total - offset);
      const reg = Number(startReg) + offset;

      let data;
      try {
        data = await readRegisters(client, regType, reg, qty);
      } catch (err) {
        for (let i = 0; i < qty; i++) {
          send({
            type: "result",
            register: reg + i,
            value: null,
            raw: null,
            dataType: regType,
            sanity: { status: "error", reason: err.message },
          });
        }
        done += qty;
        send({ type: "progress", done, total });
        continue;
      }

      for (let i = 0; i < qty && i < data.length; i++) {
        const rawVal = data[i];
        send({
          type: "result",
          register: reg + i,
          value: rawVal,
          raw: rawVal,
          dataType: regType,
          sanity: sanityCheck(rawVal, regType),
        });
      }

      done += qty;
      send({ type: "progress", done, total });

      if (!session.cancelled) await sleep(20);
    }
  } finally {
    try { client.close(); } catch (closeErr) { console.error("Error closing Modbus client:", closeErr.message); }
    send({ type: "done" });
    activeSessions.delete(id);
  }
}

// ── YAML named-register scan handler ─────────────────────────────────────────
async function handleScanYaml(ws, msg, activeSessions) {
  const { id, ip, port, unitId } = msg;
  const session = { cancelled: false };
  activeSessions.set(id, session);

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ ...obj, id }));
  };

  if (yamlRegisters.length === 0) {
    send({ type: "error", message: "No YAML registers loaded. Ensure modbus.yaml is present." });
    activeSessions.delete(id);
    return;
  }

  const client = new ModbusRTU();
  client.setTimeout(3000);

  try {
    await client.connectTCP(ip, { port: Number(port) || 502 });
    client.setID(Number(unitId) || 1);
  } catch (err) {
    send({ type: "error", message: `Connection failed: ${err.message}` });
    activeSessions.delete(id);
    return;
  }

  const total = yamlRegisters.length;
  let done = 0;

  try {
    for (const regDef of yamlRegisters) {
      if (session.cancelled) break;

      const qty = regDef.data_type === "int32" ? 2 : 1;
      let rawWords;
      try {
        rawWords = await readHoldingWords(client, regDef.address, qty);
      } catch (err) {
        send({
          type: "result",
          register: regDef.address,
          name: regDef.name,
          section: regDef.section,
          unit: regDef.unit,
          value: null,
          raw: null,
          scaledValue: null,
          dataType: regDef.data_type,
          sanity: { status: "error", reason: err.message },
        });
        done++;
        send({ type: "progress", done, total });
        await sleep(20);
        continue;
      }

      const rawInt = combineWords(rawWords, regDef.data_type);
      const scaled = applyScale(rawInt, regDef.scale, regDef.precision);

      send({
        type: "result",
        register: regDef.address,
        name: regDef.name,
        section: regDef.section,
        unit: regDef.unit,
        value: rawInt,
        raw: rawWords[0],
        scaledValue: scaled,
        dataType: regDef.data_type,
        sanity: sanityCheckYaml(scaled, rawInt, regDef),
      });

      done++;
      send({ type: "progress", done, total });
      if (!session.cancelled) await sleep(20);
    }
  } finally {
    try { client.close(); } catch (closeErr) { console.error("Error closing Modbus client:", closeErr.message); }
    send({ type: "done" });
    activeSessions.delete(id);
  }
}

// ── Modbus read helpers ───────────────────────────────────────────────────────
async function readRegisters(client, regType, address, qty) {
  switch (regType) {
    case "coil":
      return (await client.readCoils(address, qty)).data.map((b) => (b ? 1 : 0));
    case "discrete":
      return (await client.readDiscreteInputs(address, qty)).data.map((b) => (b ? 1 : 0));
    case "holding":
      return (await client.readHoldingRegisters(address, qty)).data;
    case "input":
      return (await client.readInputRegisters(address, qty)).data;
    default:
      throw new Error(`Unknown register type: ${regType}`);
  }
}

async function readHoldingWords(client, address, qty) {
  return (await client.readHoldingRegisters(address, qty)).data;
}

// Combine 1 or 2 uint16 words into a typed integer value
function combineWords(words, dataType) {
  if (dataType === "int32") {
    // Big-endian: high word first
    const u32 = ((words[0] & 0xffff) << 16) | (words[1] & 0xffff);
    return u32 | 0; // convert to signed int32
  }
  if (dataType === "int16") {
    const u16 = words[0] & 0xffff;
    return u16 > 0x7fff ? u16 - 0x10000 : u16;
  }
  // uint16
  return words[0] & 0xffff;
}

function applyScale(value, scale, precision) {
  if (value === null || value === undefined) return null;
  const scaled = value * scale;
  return parseFloat(scaled.toFixed(precision));
}

// ── Generic sanity check (raw scan) ──────────────────────────────────────────
function sanityCheck(raw, regType) {
  if (raw === null || raw === undefined) {
    return { status: "error", reason: "No data" };
  }
  if (regType === "coil" || regType === "discrete") {
    return { status: "ok", reason: "" };
  }
  if (raw === 0xffff) {
    return { status: "warn", reason: "0xFFFF – possible unconnected input or error code" };
  }
  if (raw === 0x7fff) {
    return { status: "warn", reason: "0x7FFF – possible sensor overflow (32767)" };
  }
  if (raw === 0x8000) {
    return { status: "warn", reason: "0x8000 – possible sensor underflow (-32768 signed)" };
  }
  const signed = raw > 0x7fff ? raw - 0x10000 : raw;
  if (signed < -30000 || signed > 30000) {
    return { status: "warn", reason: `Extreme value (signed: ${signed}) – verify scaling` };
  }
  return { status: "ok", reason: "" };
}

// ── YAML-aware sanity check (scaled values with units) ────────────────────────
function sanityCheckYaml(scaled, rawInt, regDef) {
  if (scaled === null || scaled === undefined) {
    return { status: "error", reason: "No data" };
  }

  const unit = (regDef.unit || "").trim();
  const name = regDef.name || "";

  // Error/state registers (no unit, "error" or "state" in name)
  if (!unit && /error|state|operating/i.test(name)) {
    if (rawInt === 0xffff) {
      return { status: "warn", reason: "0xFFFF – possible communication error" };
    }
    return { status: "ok", reason: "" };
  }

  // Temperature (°C)
  if (unit === "°C") {
    if (scaled < -40)  return { status: "warn", reason: `Temperature ${scaled} °C is below −40 °C – sensor may be faulty` };
    if (scaled > 120)  return { status: "warn", reason: `Temperature ${scaled} °C exceeds 120 °C – check sensor` };
    // Flag likely stuck at 0 only if we'd expect a non-zero reading (not set-points)
    if (scaled === 0 && /actual|flow|return|source|ambient/i.test(name)) {
      return { status: "warn", reason: "Temperature reads 0 °C – sensor may be disconnected" };
    }
    return { status: "ok", reason: "" };
  }

  // Power (W)
  if (unit === "W") {
    if (scaled < -30000) return { status: "warn", reason: `Power ${scaled} W seems unexpectedly low` };
    if (scaled > 30000)  return { status: "warn", reason: `Power ${scaled} W seems unexpectedly high` };
    return { status: "ok", reason: "" };
  }

  // Thermal power (kW)
  if (unit === "kW") {
    if (scaled < -50) return { status: "warn", reason: `Thermal power ${scaled} kW seems unexpectedly low` };
    if (scaled > 50)  return { status: "warn", reason: `Thermal power ${scaled} kW seems unexpectedly high` };
    return { status: "ok", reason: "" };
  }

  // Percentage
  if (unit === "%") {
    if (scaled < 0)   return { status: "warn", reason: `Percentage ${scaled} % is negative` };
    if (scaled > 100) return { status: "warn", reason: `Percentage ${scaled} % exceeds 100 %` };
    return { status: "ok", reason: "" };
  }

  // Energy (Wh) – should be non-negative accumulated counter
  if (unit === "Wh") {
    if (scaled < 0) return { status: "warn", reason: `Energy counter ${scaled} Wh is negative – check register` };
    return { status: "ok", reason: "" };
  }

  // Volume flow (l/h or l/min)
  if (unit === "l/h" || unit === "l/min") {
    if (scaled < 0)   return { status: "warn", reason: `Flow ${scaled} ${unit} is negative` };
    if (scaled > 5000) return { status: "warn", reason: `Flow ${scaled} ${unit} seems very high` };
    return { status: "ok", reason: "" };
  }

  // Generic 0xFFFF guard for any remaining types
  if (rawInt === 0xffff || rawInt === -1) {
    return { status: "warn", reason: "0xFFFF – possible unconnected input" };
  }

  return { status: "ok", reason: "" };
}

// ── Discover all registers handler ───────────────────────────────────────────
//
// Probes all four register types across addresses 0–65535, reporting only
// registers that the device actually responds to. Error responses (e.g. Modbus
// exception code 2 = Illegal Data Address) are silently skipped.
//
// Strategy per register type:
//   1. Try batches of DISCOVER_BATCH registers at a time.
//   2. On success, emit all values in the batch.
//   3. On error, fall back to probing one register at a time so we don't miss
//      a valid register that is adjacent to an invalid one.
//
const DISCOVER_TYPES = ["holding", "input", "coil", "discrete"];
const DISCOVER_BATCH = 10;      // registers per batch attempt
const DISCOVER_MAX   = 65536;   // full 16-bit address space per type
const DISCOVER_TIMEOUT = 2000;  // ms per request

async function handleDiscover(ws, msg, activeSessions) {
  const { id, ip, port, unitId } = msg;
  const session = { cancelled: false };
  activeSessions.set(id, session);

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ ...obj, id }));
  };

  const client = new ModbusRTU();
  client.setTimeout(DISCOVER_TIMEOUT);

  try {
    await client.connectTCP(ip, { port: Number(port) || 502 });
    client.setID(Number(unitId) || 1);
  } catch (err) {
    send({ type: "error", message: `Connection failed: ${err.message}` });
    activeSessions.delete(id);
    return;
  }

  // Total steps = 4 types × 65536 addresses (for progress tracking)
  const totalSteps = DISCOVER_TYPES.length * DISCOVER_MAX;
  let doneSteps = 0;

  try {
    for (const regType of DISCOVER_TYPES) {
      if (session.cancelled) break;

      let addr = 0;
      while (addr < DISCOVER_MAX && !session.cancelled) {
        const qty = Math.min(DISCOVER_BATCH, DISCOVER_MAX - addr);

        let data = null;
        try {
          data = await readRegisters(client, regType, addr, qty);
        } catch {
          // Batch failed – try each register individually to avoid missing valid ones
          for (let i = 0; i < qty && !session.cancelled; i++) {
            try {
              const single = await readRegisters(client, regType, addr + i, 1);
              send({
                type: "result",
                discover: true,
                regType,
                register: addr + i,
                value: single[0],
                raw: single[0],
                dataType: regType,
                sanity: sanityCheck(single[0], regType),
              });
            } catch {
              // Register truly not available — skip silently
            }
          }
          doneSteps += qty;
          send({ type: "progress", done: doneSteps, total: totalSteps, phase: regType });
          addr += qty;
          await sleep(10);
          continue;
        }

        // Batch succeeded – emit all values
        for (let i = 0; i < data.length; i++) {
          send({
            type: "result",
            discover: true,
            regType,
            register: addr + i,
            value: data[i],
            raw: data[i],
            dataType: regType,
            sanity: sanityCheck(data[i], regType),
          });
        }

        doneSteps += qty;
        send({ type: "progress", done: doneSteps, total: totalSteps, phase: regType });
        addr += qty;
        await sleep(10);
      }

      // Advance progress to end of this type if cancelled early
      if (session.cancelled) break;
    }
  } finally {
    try { client.close(); } catch (closeErr) { console.error("Error closing Modbus client:", closeErr.message); }
    send({ type: "done" });
    activeSessions.delete(id);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(HTTP_PORT, () => {
  console.log(`Modbus Scanner running → http://localhost:${HTTP_PORT}`);
});

