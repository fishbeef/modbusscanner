/**
 * Modbus TCP Test Server
 *
 * Simulates a heat-pump / HVAC controller with a realistic register map.
 * Values are updated every UPDATE_INTERVAL_MS milliseconds so the scanner
 * can observe live changes.
 *
 * Usage:
 *   node server.js [port] [update_interval_ms]
 *
 * Defaults:
 *   port                = 5020   (use 502 if you have root / admin rights)
 *   update_interval_ms  = 5000   (5 seconds)
 *
 * Environment variables override CLI args:
 *   MODBUS_PORT         TCP port to listen on
 *   UPDATE_INTERVAL     Value update interval in ms
 *   UNIT_ID             Modbus unit/slave ID (default 1)
 *
 * Register map
 * ─────────────────────────────────────────────────────────────────────────────
 * HOLDING REGISTERS  (FC 03 – read/write)
 *   0   Temperature setpoint   int16 × 0.1  °C   (e.g. 200 = 20.0 °C)
 *   1   DHW setpoint           int16 × 0.1  °C
 *   2   Operating mode         uint16            0=Off 1=Heating 2=Cooling 3=Standby
 *   3   Pump speed setpoint    uint16  %         0-100
 *   4   Fan speed setpoint     uint16  RPM       0-3000
 *   5   Power limit            uint16  W         0-10000
 *   6   Energy counter lo      uint16  Wh        low  word of uint32
 *   7   Energy counter hi      uint16  Wh        high word of uint32
 *   8   Error code             uint16            0 = no error
 *   9   Runtime hours          uint16  h
 *
 * INPUT REGISTERS  (FC 04 – read-only)
 *   0   Ambient temperature    int16 × 0.1  °C
 *   1   Flow temperature       int16 × 0.1  °C
 *   2   Return temperature     int16 × 0.1  °C
 *   3   Source temperature     int16 × 0.1  °C
 *   4   Actual power           uint16  W
 *   5   Flow rate              uint16  l/h
 *   6   High pressure          uint16  × 0.01 bar
 *   7   Low pressure           uint16  × 0.01 bar
 *   8   COP                    uint16  × 0.01
 *   9   Compressor speed       uint16  RPM
 *
 * COILS  (FC 01 – read/write)
 *   0   System enable
 *   1   Heating demand
 *   2   Cooling demand
 *   3   DHW demand
 *   4   Pump running
 *   5   Fan running
 *   6   Compressor running
 *   7   Alarm active
 *
 * DISCRETE INPUTS  (FC 02 – read-only)
 *   0   High-pressure switch (NC = 1 when OK)
 *   1   Low-pressure switch  (NC = 1 when OK)
 *   2   Flow switch          (1 = flow detected)
 *   3   Anti-freeze          (1 = active)
 *   4   External enable      (1 = enabled by external BMS)
 *   5   External demand      (1 = demand from external BMS)
 */

"use strict";

const ModbusRTU = require("modbus-serial");

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT            = Number(process.env.MODBUS_PORT    || process.argv[2]) || 5020;
const UPDATE_INTERVAL = Number(process.env.UPDATE_INTERVAL || process.argv[3]) || 5000;
const UNIT_ID         = Number(process.env.UNIT_ID        || 1);

// ── Internal state ─────────────────────────────────────────────────────────────
// All values are stored in their "raw" (wire) form, matching what Modbus actually
// transmits over the network.

// Holding registers (writable by external clients too)
const holdingRegs = new Int16Array([
  200,   // 0  Temperature setpoint  20.0 °C  (int16 × 0.1)
  480,   // 1  DHW setpoint          48.0 °C
  1,     // 2  Operating mode        1 = Heating
  60,    // 3  Pump speed setpoint   60 %
  1200,  // 4  Fan speed setpoint    1200 RPM
  5000,  // 5  Power limit           5000 W
  0,     // 6  Energy counter lo     (uint32 low word)
  0,     // 7  Energy counter hi     (uint32 high word)
  0,     // 8  Error code            0 = no error
  0,     // 9  Runtime hours
]);

// Input registers (read-only from client perspective)
const inputRegs = new Int16Array([
   80,   // 0  Ambient temperature   8.0 °C
  350,   // 1  Flow temperature      35.0 °C
  280,   // 2  Return temperature    28.0 °C
   60,   // 3  Source temperature    6.0 °C
  3200,  // 4  Actual power          3200 W
  1200,  // 5  Flow rate             1200 l/h
  2450,  // 6  High pressure         24.50 bar
   380,  // 7  Low pressure          3.80 bar
   415,  // 8  COP                   4.15
  2900,  // 9  Compressor speed      2900 RPM
]);

// Coils (booleans, writable)
const coils = [
  true,   // 0  System enable
  true,   // 1  Heating demand
  false,  // 2  Cooling demand
  false,  // 3  DHW demand
  true,   // 4  Pump running
  true,   // 5  Fan running
  true,   // 6  Compressor running
  false,  // 7  Alarm active
];

// Discrete inputs (booleans, read-only)
const discreteInputs = [
  true,   // 0  High-pressure switch OK
  true,   // 1  Low-pressure switch OK
  true,   // 2  Flow switch – flow detected
  false,  // 3  Anti-freeze active
  true,   // 4  External enable
  true,   // 5  External demand
];

// ── Simulation helpers ────────────────────────────────────────────────────────

// Seeded sine wave helper – returns a value oscillating between min and max
function sineWave(min, max, periodMs, phaseMs = 0) {
  const t = (Date.now() + phaseMs) / periodMs;
  const norm = (Math.sin(2 * Math.PI * t) + 1) / 2; // 0..1
  return min + norm * (max - min);
}

// Random walk – nudge a value by ±delta, clamped to [min, max]
function randomWalk(current, delta, min, max) {
  const nudge = (Math.random() * 2 - 1) * delta;
  return Math.max(min, Math.min(max, current + nudge));
}

// Pack/unpack uint32 from two uint16 words (big-endian: hi first)
function packUint32(hi, lo) {
  return ((hi & 0xffff) * 65536 + (lo & 0xffff)) >>> 0;
}
function uint32Words(value) {
  const v = value >>> 0;
  return { hi: (v >>> 16) & 0xffff, lo: v & 0xffff };
}

// ── Periodic value update ─────────────────────────────────────────────────────
let tick = 0;
let totalEnergyWh = 0;
let runtimeHours = 0;

function updateValues() {
  tick++;

  // ── Ambient temperature: sine wave –5 °C … +15 °C (period 2 min)
  const ambientRaw = Math.round(sineWave(-50, 150, 120_000, 0));
  inputRegs[0] = ambientRaw;

  // ── Source temperature follows ambient with +2 °C offset, slower drift
  const sourceRaw = Math.round(sineWave(ambientRaw - 10, ambientRaw + 30, 180_000, 15_000));
  inputRegs[3] = Math.max(-100, Math.min(200, sourceRaw));

  // ── Flow / return temperatures: random walk within realistic ranges
  inputRegs[1] = Math.round(randomWalk(inputRegs[1], 5, 250, 550));  // 25–55 °C
  inputRegs[2] = Math.round(randomWalk(inputRegs[2], 3, 200, 450));  // 20–45 °C

  // ── Actual power: sine wave 1.5 kW … 6 kW (period 90 s)
  const powerRaw = Math.round(sineWave(1500, 6000, 90_000, 5_000));
  inputRegs[4] = powerRaw;

  // ── Flow rate: random walk 800 … 1800 l/h
  inputRegs[5] = Math.round(randomWalk(inputRegs[5], 30, 800, 1800));

  // ── Pressures: gentle random walk
  inputRegs[6] = Math.round(randomWalk(inputRegs[6], 20, 2200, 2800));  // 22–28 bar
  inputRegs[7] = Math.round(randomWalk(inputRegs[7], 10,  300,  500));  //  3–5 bar

  // ── COP: derived from power and heating output (simplified)
  const flowDeltaK = (inputRegs[1] - inputRegs[2]) * 0.1; // K
  const massFlowKgs = inputRegs[5] / 3600;                 // l/s ≈ kg/s for water
  const thermalW = massFlowKgs * 4186 * Math.max(0, flowDeltaK);
  const cop = inputRegs[4] > 0 ? thermalW / inputRegs[4] : 0;
  inputRegs[8] = Math.round(Math.max(0, Math.min(999, cop)) * 100); // × 0.01

  // ── Compressor speed: follows power demand roughly
  inputRegs[9] = Math.round(sineWave(1500, 4000, 90_000, 5_000));

  // ── Energy counter: accumulate based on actual power
  const intervalHours = UPDATE_INTERVAL / 3_600_000;
  totalEnergyWh += powerRaw * intervalHours;
  const words = uint32Words(Math.round(totalEnergyWh));
  holdingRegs[6] = words.lo;
  holdingRegs[7] = words.hi;

  // ── Runtime hours (only when compressor is running)
  if (coils[6]) {
    runtimeHours += UPDATE_INTERVAL / 3_600_000;
    holdingRegs[9] = Math.round(runtimeHours);
  }

  // ── Operating mode cycles every 30 ticks: Off → Heating → Cooling → Standby
  holdingRegs[2] = tick % 30 < 10 ? 0
                 : tick % 30 < 20 ? 1
                 : tick % 30 < 25 ? 2
                 : 3;

  // ── Coils: reflect current mode
  const mode = holdingRegs[2];
  coils[1] = mode === 1;   // Heating demand
  coils[2] = mode === 2;   // Cooling demand
  coils[4] = mode !== 0;   // Pump running (not Off)
  coils[5] = mode !== 0;   // Fan running
  coils[6] = mode === 1 || mode === 2; // Compressor only in active modes

  // ── Random alarm toggle (approx 5% probability per update)
  coils[7] = Math.random() < 0.05;
  holdingRegs[8] = coils[7] ? Math.floor(Math.random() * 10) + 1 : 0;

  // ── Discrete: flow switch off when pump is stopped
  discreteInputs[2] = coils[4];
  // Anti-freeze: active if flow temp drops below 5 °C (raw < 50)
  discreteInputs[3] = inputRegs[1] < 50;

  logState();
}

function logState() {
  const amb   = (inputRegs[0] * 0.1).toFixed(1);
  const flow  = (inputRegs[1] * 0.1).toFixed(1);
  const ret   = (inputRegs[2] * 0.1).toFixed(1);
  const pwr   = inputRegs[4];
  const mode  = ["Off", "Heating", "Cooling", "Standby"][holdingRegs[2]] || "?";
  const alarm = coils[7] ? ` ⚠  Error ${holdingRegs[8]}` : "";
  console.log(
    `[tick ${String(tick).padStart(4)}] mode=${mode.padEnd(8)}` +
    ` amb=${String(amb).padStart(6)} °C` +
    ` flow=${String(flow).padStart(6)} °C` +
    ` ret=${String(ret).padStart(6)} °C` +
    ` pwr=${String(pwr).padStart(5)} W` +
    ` energy=${Math.round(totalEnergyWh)} Wh` +
    alarm
  );
}

// ── Modbus request handlers ───────────────────────────────────────────────────
const vector = {
  // FC 01 – Read Coils
  getCoil(addr) {
    if (addr < 0 || addr >= coils.length) return false;
    return coils[addr];
  },

  // FC 05 / FC 15 – Write Coil(s)
  setCoil(addr, value) {
    if (addr >= 0 && addr < coils.length) {
      coils[addr] = !!value;
    }
  },

  // FC 02 – Read Discrete Inputs
  getDiscreteInput(addr) {
    if (addr < 0 || addr >= discreteInputs.length) return false;
    return discreteInputs[addr];
  },

  // FC 03 – Read Holding Registers
  getHoldingRegister(addr) {
    if (addr < 0 || addr >= holdingRegs.length) return 0;
    // Return as unsigned 16-bit so the wire encoding is correct
    return holdingRegs[addr] & 0xffff;
  },

  // FC 06 / FC 16 – Write Holding Register(s)
  setRegister(addr, value) {
    if (addr >= 0 && addr < holdingRegs.length) {
      holdingRegs[addr] = value & 0xffff;
    }
  },

  // FC 04 – Read Input Registers
  getInputRegister(addr) {
    if (addr < 0 || addr >= inputRegs.length) return 0;
    return inputRegs[addr] & 0xffff;
  },
};

// ── Start server ──────────────────────────────────────────────────────────────
const server = new ModbusRTU.ServerTCP(vector, {
  host: "0.0.0.0",
  port: PORT,
  debug: false,
  unitID: UNIT_ID,
});

server.on("initialized", () => {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Modbus TCP Test Server – ready                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Port             : ${PORT}`);
  console.log(`  Unit ID          : ${UNIT_ID}`);
  console.log(`  Update interval  : ${UPDATE_INTERVAL} ms`);
  console.log("");
  console.log("  Register map summary:");
  console.log("    Holding (FC 03)  : 0-9   setpoints, mode, energy, errors");
  console.log("    Input   (FC 04)  : 0-9   temperatures, power, pressure, COP");
  console.log("    Coils   (FC 01)  : 0-7   enable flags, actuator states");
  console.log("    Discrete(FC 02)  : 0-5   safety switches, external signals");
  console.log("");

  // Run one update immediately so values are non-zero from the start
  updateValues();

  // Then update on the configured interval
  setInterval(updateValues, UPDATE_INTERVAL);
});

server.on("socketError", (err) => {
  console.error("Socket error:", err.message);
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
});
