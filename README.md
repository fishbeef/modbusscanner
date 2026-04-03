# Modbus TCP Scanner

A clean web-based Modbus TCP register scanner. Scan any Modbus TCP device from your browser — configure the IP, port, unit ID, and register range, then view live results with automatic sanity checks.

## Quick Start

```bash
# Install dependencies (Node.js ≥ 16 required)
npm install

# Start the server
npm start
```

Then open **http://localhost:8080** in your browser.

## Features

- **Modbus TCP** — connects to any Modbus TCP device (default: `192.168.1.40:502`)
- **All register types** — Holding Registers (4x), Input Registers (3x), Coils (0x), Discrete Inputs (1x)
- **Configurable** — IP address, port, unit ID, register range, batch size
- **Live results** — register values shown as unsigned, signed, hex, and binary
- **Sanity checks** — automatic warnings for `0xFFFF`, extreme signed values, sensor overflow/underflow; optional user-defined min/max range
- **Filter & search** — filter by register number, value, or sanity status
- **CSV export** — download all results as a CSV file
- **Scan cancel** — cancel a running scan at any time

## Configuration

| Field | Default | Description |
|---|---|---|
| IP Address | `192.168.1.40` | Target Modbus TCP device IP |
| Port | `502` | Modbus TCP port |
| Unit ID | `1` | Modbus unit/slave ID |
| Start Register | `0` | First register address to scan |
| Count | `100` | Number of registers to read |
| Batch Size | `10` | Registers per Modbus request (max 125) |
| Min / Max Value | *(none)* | Optional sanity range for register values |

## Sanity Check Rules

| Status | Condition |
|---|---|
| ✓ OK | Value is within normal range |
| ⚠ Warning | `0xFFFF` (possible unconnected input), `0x7FFF`/`0x8000` (overflow/underflow), signed value outside ±30000, or outside user-defined range |
| ✕ Error | Register could not be read (communication error) |

## Server Port

Set the `PORT` environment variable to use a different HTTP port:

```bash
PORT=3000 npm start
```
