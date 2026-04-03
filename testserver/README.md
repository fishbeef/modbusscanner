# Modbus TCP Test Server

A lightweight Modbus TCP server that simulates a heat-pump / HVAC controller. Use it to test the **Modbus Scanner** before connecting to a real machine.

## Quick start

```bash
cd testserver
npm install
npm start
```

The server starts on **port 5020** by default (no root/admin rights required).

### Custom port and update interval

```bash
# node server.js <port> <update_interval_ms>
node server.js 5020 3000        # port 5020, update every 3 s
node server.js 502  10000       # port 502,  update every 10 s (root required)
```

Environment variables are also supported and override CLI arguments:

| Variable          | Default | Description                           |
|-------------------|---------|---------------------------------------|
| `MODBUS_PORT`     | `5020`  | TCP port to listen on                 |
| `UPDATE_INTERVAL` | `5000`  | Value update interval in milliseconds |
| `UNIT_ID`         | `1`     | Modbus unit / slave ID                |

---

## Register map

### Holding registers – FC 03 (read/write)

| Address | Name                  | Type   | Scale | Unit | Notes                            |
|---------|-----------------------|--------|-------|------|----------------------------------|
| 0       | Temperature setpoint  | int16  | ×0.1  | °C   | 200 = 20.0 °C                    |
| 1       | DHW setpoint          | int16  | ×0.1  | °C   | 480 = 48.0 °C                    |
| 2       | Operating mode        | uint16 | –     | –    | 0=Off 1=Heating 2=Cooling 3=Standby |
| 3       | Pump speed setpoint   | uint16 | –     | %    | 0–100                            |
| 4       | Fan speed setpoint    | uint16 | –     | RPM  | 0–3000                           |
| 5       | Power limit           | uint16 | –     | W    | 0–10000                          |
| 6       | Energy counter lo     | uint16 | –     | Wh   | Low word of uint32               |
| 7       | Energy counter hi     | uint16 | –     | Wh   | High word of uint32              |
| 8       | Error code            | uint16 | –     | –    | 0 = no error                     |
| 9       | Runtime hours         | uint16 | –     | h    | Accumulated compressor hours     |

### Input registers – FC 04 (read-only)

| Address | Name                | Type   | Scale | Unit | Notes          |
|---------|---------------------|--------|-------|------|----------------|
| 0       | Ambient temperature | int16  | ×0.1  | °C   | −5 … +15 °C sine |
| 1       | Flow temperature    | int16  | ×0.1  | °C   | random walk 25–55 °C |
| 2       | Return temperature  | int16  | ×0.1  | °C   | random walk 20–45 °C |
| 3       | Source temperature  | int16  | ×0.1  | °C   | follows ambient |
| 4       | Actual power        | uint16 | –     | W    | 1500–6000 W sine |
| 5       | Flow rate           | uint16 | –     | l/h  | random walk 800–1800 |
| 6       | High pressure       | uint16 | ×0.01 | bar  | 22–28 bar      |
| 7       | Low pressure        | uint16 | ×0.01 | bar  | 3–5 bar        |
| 8       | COP                 | uint16 | ×0.01 | –    | derived value  |
| 9       | Compressor speed    | uint16 | –     | RPM  | 1500–4000 sine |

### Coils – FC 01 (read/write)

| Address | Name               | Notes                            |
|---------|--------------------|----------------------------------|
| 0       | System enable      | always true                      |
| 1       | Heating demand     | mirrors operating mode = 1       |
| 2       | Cooling demand     | mirrors operating mode = 2       |
| 3       | DHW demand         | always false in simulation       |
| 4       | Pump running       | false only when mode = Off       |
| 5       | Fan running        | false only when mode = Off       |
| 6       | Compressor running | true during Heating / Cooling    |
| 7       | Alarm active       | random ~5 % chance per tick      |

### Discrete inputs – FC 02 (read-only)

| Address | Name                  | Notes                           |
|---------|-----------------------|---------------------------------|
| 0       | High-pressure switch  | normally-closed (1 = OK)        |
| 1       | Low-pressure switch   | normally-closed (1 = OK)        |
| 2       | Flow switch           | 1 when pump running             |
| 3       | Anti-freeze active    | 1 when flow temp < 5 °C         |
| 4       | External enable       | always true in simulation       |
| 5       | External demand       | always true in simulation       |

---

## Simulated behaviour

- **Operating mode** cycles every 30 update ticks: Off (10) → Heating (10) → Cooling (5) → Standby (5)
- **Temperatures** use sine waves and random-walk algorithms to produce realistic variation
- **Power** follows a 90-second sine wave between 1.5 kW and 6 kW
- **Energy counter** accumulates based on actual power at each tick
- **Alarm** triggers randomly (~5 % per tick) with a random error code 1–10

---

## Connecting the Modbus Scanner

Start the scanner app (`npm start` in the project root) and configure it to connect to:

| Setting   | Value      |
|-----------|------------|
| IP        | `127.0.0.1` (or LAN IP if running remotely) |
| Port      | `5020`     |
| Unit ID   | `1`        |
