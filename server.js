/**
 * Modbus TCP Scanner – WebSocket + HTTP server
 *
 * Serves index.html and bridges WebSocket messages to Modbus TCP.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Server:
 *     { type: "scan", id, ip, port, unitId, regType, startReg, count, batchSize }
 *     { type: "cancel", id }
 *
 *   Server → Client:
 *     { type: "result",  id, register, value, raw, dataType, sanity }
 *     { type: "progress",id, done, total }
 *     { type: "done",    id }
 *     { type: "error",   id, message }
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const ModbusRTU = require("modbus-serial");

const HTTP_PORT = process.env.PORT || 8080;

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

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "scan") {
      handleScan(ws, msg, activeSessions);
    } else if (msg.type === "cancel") {
      const sess = activeSessions.get(msg.id);
      if (sess) sess.cancelled = true;
    }
  });

  ws.on("close", () => {
    // Cancel all running scans for this connection
    for (const sess of activeSessions.values()) {
      sess.cancelled = true;
    }
  });
});

// ── Scan handler ─────────────────────────────────────────────────────────────
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
        // Report error for this batch then continue
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
        const result = interpretValue(rawVal, regType);
        send({
          type: "result",
          register: reg + i,
          value: result.value,
          raw: rawVal,
          dataType: regType,
          sanity: sanityCheck(rawVal, regType),
        });
      }

      done += qty;
      send({ type: "progress", done, total });

      // Small delay to avoid flooding the device
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

// ── Value interpretation ──────────────────────────────────────────────────────
function interpretValue(raw, regType) {
  if (regType === "coil" || regType === "discrete") {
    return { value: raw === 1 ? "ON" : "OFF" };
  }
  // 16-bit register: return unsigned value (UI shows signed interpretation too)
  return { value: raw };
}

// ── Sanity checks ─────────────────────────────────────────────────────────────
function sanityCheck(raw, regType) {
  if (raw === null || raw === undefined) {
    return { status: "error", reason: "No data" };
  }

  if (regType === "coil" || regType === "discrete") {
    // Boolean registers are always valid
    return { status: "ok", reason: "" };
  }

  // 16-bit register checks
  if (raw === 0xffff) {
    return { status: "warn", reason: "0xFFFF – possible unconnected input or error code" };
  }

  if (raw === 0x7fff) {
    return { status: "warn", reason: "0x7FFF – possible sensor overflow (32767)" };
  }

  if (raw === 0x8000) {
    return { status: "warn", reason: "0x8000 – possible sensor underflow (-32768 signed)" };
  }

  // Signed interpretation
  const signed = raw > 0x7fff ? raw - 0x10000 : raw;
  if (signed < -30000 || signed > 30000) {
    return { status: "warn", reason: `Extreme value (signed: ${signed}) – verify scaling` };
  }

  return { status: "ok", reason: "" };
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(HTTP_PORT, () => {
  console.log(`Modbus Scanner running → http://localhost:${HTTP_PORT}`);
});
