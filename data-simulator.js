/**
 * Data Simulator Service for Testing
 *
 * Generates realistic Modbus data for testing and development.
 * Simulates temperature curves, power cycles, and pressure variations.
 */

"use strict";

class DataSimulator {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.updateInterval = options.updateInterval || 2000; // 2 seconds
    this.simulationTimer = null;
    this.tick = 0;

    // Simulated register definitions
    this.registers = [
      {
        name: "Ambient_Temperature",
        register: 0,
        section: "Ambient",
        unit: "°C",
        dataType: "int16",
        min: -10,
        max: 30,
        generator: "sine",
        period: 300000, // 5 minutes
      },
      {
        name: "Flow_Temperature",
        register: 1,
        section: "Thermal",
        unit: "°C",
        dataType: "int16",
        min: 20,
        max: 55,
        generator: "randomWalk",
      },
      {
        name: "Return_Temperature",
        register: 2,
        section: "Thermal",
        unit: "°C",
        dataType: "int16",
        min: 15,
        max: 45,
        generator: "randomWalk",
      },
      {
        name: "Source_Temperature",
        register: 3,
        section: "Ambient",
        unit: "°C",
        dataType: "int16",
        min: -5,
        max: 25,
        generator: "sine",
        period: 240000,
      },
      {
        name: "Actual_Power",
        register: 4,
        section: "Power",
        unit: "W",
        dataType: "uint16",
        min: 1500,
        max: 6000,
        generator: "sine",
        period: 90000,
      },
      {
        name: "Flow_Rate",
        register: 5,
        section: "Hydraulic",
        unit: "l/h",
        dataType: "uint16",
        min: 800,
        max: 1800,
        generator: "randomWalk",
      },
      {
        name: "High_Pressure",
        register: 6,
        section: "Pressure",
        unit: "bar",
        dataType: "uint16",
        min: 22,
        max: 28,
        scale: 0.01,
        generator: "randomWalk",
      },
      {
        name: "Low_Pressure",
        register: 7,
        section: "Pressure",
        unit: "bar",
        dataType: "uint16",
        min: 3,
        max: 5,
        scale: 0.01,
        generator: "randomWalk",
      },
      {
        name: "COP",
        register: 8,
        section: "Efficiency",
        unit: "",
        dataType: "uint16",
        min: 2.5,
        max: 4.5,
        scale: 0.01,
        generator: "sine",
        period: 120000,
      },
      {
        name: "Compressor_Speed",
        register: 9,
        section: "Compressor",
        unit: "RPM",
        dataType: "uint16",
        min: 1500,
        max: 4000,
        generator: "sine",
        period: 90000,
      },
    ];

    // Store current values
    this.values = {};
    this.registers.forEach((r) => {
      this.values[r.name] = (r.min + r.max) / 2;
    });
  }

  /**
   * Start generating simulated data
   */
  start() {
    if (!this.enabled) return;
    console.log("[DataSimulator] Starting data generation");

    this.simulationTimer = setInterval(() => {
      this.tick++;
      this.generateValues();
    }, this.updateInterval);
  }

  /**
   * Stop generating data
   */
  stop() {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }

  /**
   * Generate next set of simulated values
   */
  generateValues() {
    this.registers.forEach((reg) => {
      switch (reg.generator) {
        case "sine":
          this.values[reg.name] = this.sineWave(
            reg.min,
            reg.max,
            reg.period || 300000
          );
          break;
        case "randomWalk":
          this.values[reg.name] = this.randomWalk(
            this.values[reg.name],
            (reg.max - reg.min) * 0.05, // 5% delta
            reg.min,
            reg.max
          );
          break;
      }
    });
  }

  /**
   * Generate sine wave value
   */
  sineWave(min, max, period) {
    const t = (Date.now() % period) / period;
    const norm = (Math.sin(2 * Math.PI * t) + 1) / 2; // 0..1
    return min + norm * (max - min);
  }

  /**
   * Generate random walk value
   */
  randomWalk(current, delta, min, max) {
    const nudge = (Math.random() * 2 - 1) * delta;
    return Math.max(min, Math.min(max, current + nudge));
  }

  /**
   * Get reading for a register
   */
  getReading(regDef) {
    const value = this.values[regDef.name] || 0;
    const raw = Math.round(value / (regDef.scale || 1));

    return {
      type: "result",
      register: regDef.register,
      name: regDef.name,
      section: regDef.section,
      unit: regDef.unit,
      value: raw,
      raw: raw,
      scaledValue: value,
      dataType: regDef.dataType,
      sanity: { status: "ok", reason: "" },
    };
  }

  /**
   * Get all current readings
   */
  getAllReadings(ip = "127.0.0.1", port = 502, unitId = 1) {
    return this.registers.map((reg) => ({
      ...this.getReading(reg),
      ip,
      port,
      unitId,
      timestamp: new Date().toISOString(),
    }));
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = DataSimulator;
}
