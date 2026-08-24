# Architecture Overview

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         WEB BROWSER                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Dashboard UI (index.html + dashboard.js)                              │ │
│  │  - Real-time temperature graphs (Chart.js)                             │ │
│  │  - Connection status indicator                                         │ │
│  │  - Data export buttons (CSV/JSON)                                      │ │
│  │  - Live readings table                                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ WebSocket
                               │ (auto-retry with backoff)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    NODE.JS SERVER (server.js)                                │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  WebSocket Server (ws)                                                 │ │
│  │  - Handles client connections                                          │ │
│  │  - Routes messages to Modbus handlers                                  │ │
│  │  - Broadcasts progress/results                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Scan Handlers                                                         │ │
│  │  ┌──────────────────────┐  ┌──────────────────────┐                    │ │
│  │  │  Raw Range Scan      │  │   YAML Scan          │                    │ │
│  │  │  (registers 0-N)     │  │  (named sensors)     │                    │ │
│  │  └──────────────────────┘  └──────────────────────┘                    │ │
│  │  ┌──────────────────────────────────────────────────┐                  │ │
│  │  │  Auto-Discovery (all registers)                  │                  │ │
│  │  └──────────────────────────────────────────────────┘                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Modbus TCP Client (modbus-serial)                                     │ │
│  │  - Connects to device on IP:port                                       │ │
│  │  - Reads holding registers, input registers                            │ │
│  │  - Reads coils and discrete inputs                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Data Processing                                                       │ │
│  │  - Word combining (uint16 → int32)                                     │ │
│  │  - Scale & precision application                                       │ │
│  │  - Sanity checking (range, bounds)                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  HTTP Endpoints                                                        │ │
│  │  - GET /api/export/csv         Export all readings                     │ │
│  │  - GET /api/export/json        Export as JSON                          │ │
│  │  - GET /api/stats              Database statistics                     │ │
│  │  - GET /api/tags               List unique tags                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │ SQL Queries
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                   SQLite Database (datastore.js)                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  scan_metadata                                                         │ │
│  │  - scan_id, timestamp, ip, port, unitId                                │ │
│  │  - scan_type, register_count, duration_ms                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  readings (indexed for fast queries)                                    │ │
│  │  - timestamp, ip, port, unitId, register                               │ │
│  │  - name, section, dataType, unit                                       │ │
│  │  - value, scaledValue, raw_word                                        │ │
│  │  - sanity_status, sanity_reason                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  settings                                                              │ │
│  │  - Retention policy, user preferences                                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

     ┌──────────────────────────────────────────────────────┐
     │   Modbus TCP Device (Heat Pump, Boiler)              │
     │   - Input Registers (read-only)                      │
     │   - Holding Registers (read/write)                   │
     │   - Coils (read/write)                               │
     │   - Discrete Inputs (read-only)                      │
     └──────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Connection & Authentication
```
Browser → Connect Button
  ↓
ConnectionManager (exponential backoff)
  ↓
WebSocket.connect()
  ↓
Server accepts connection
  ↓
Server sends YAML config
  ↓
Dashboard updates UI
```

### 2. YAML Scan Flow
```
User clicks \"Scan\"
  ↓
Dashboard.connect(ip, port, unitId)
  ↓
WebSocket sends {type: \"scan_yaml\", id, ip, port, unitId}
  ↓
Server.handleScanYaml()
  ↓
For each register in YAML:
  - Connect to Modbus device
  - Read holding registers (1-2 words)
  - Combine words (uint16 → int32)
  - Apply scale & precision
  - Sanity check value
  - Send result via WebSocket
  - Record to SQLite
  ↓
Dashboard receives results
  ↓
Update chart + table
  ↓
User sees real-time data
```

### 3. Data Persistence
```
Result received from Modbus
  ↓
DataStore.recordReading(scanId, ip, port, unitId, reading)
  ↓
Insert into SQLite readings table
  ↓
Indexes on: timestamp, ip, port, register, name
  ↓
Available for export (CSV/JSON)
```

### 4. Export Flow
```
User clicks \"Export CSV\"
  ↓
Modal shows format options
  ↓
User selects format
  ↓
Browser requests: GET /api/export/csv?all=true
  ↓
Server queries SQLite
  ↓
Generate CSV with headers:
  Timestamp | IP | Port | Unit ID | Register | Tag | Section | Type | Unit | Value | Scaled | Status | Reason
  ↓
Return as download
  ↓
User opens in Excel
```

## Component Responsibilities

### Browser (Frontend)
- **connection-manager.js**: Handle WebSocket with auto-retry
- **dashboard.js**: Render UI, manage charts, handle user actions
- **data-simulator.js**: Generate test data for development
- **index.html**: Main UI template

### Server (Backend)
- **server.js**: HTTP + WebSocket server, Modbus handling
- **datastore.js**: SQLite database operations
- **package.json**: Dependencies management

### Testing
- **tests.js**: Comprehensive unit tests
- **.github/workflows/ci-cd.yml**: GitHub Actions pipeline

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | HTML5, CSS3, JavaScript | Dashboard UI |
| Graphing | Chart.js 4.4.0 | Real-time line graphs |
| Communication | WebSocket | Real-time data streaming |
| Backend | Node.js | Server runtime |
| Modbus | modbus-serial | Modbus TCP client |
| Database | SQLite3 | Data persistence |
| Config | js-yaml | YAML parsing |
| Testing | Node.js assert | Unit tests |
| CI/CD | GitHub Actions | Automated testing & deployment |

## Error Handling & Resilience

### Connection Resilience
```javascript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s... (max 30s)\ndelay = min(initialDelay × 2^retryCount, maxDelay)\n// Max 10 retry attempts before giving up\n```

### Data Validation
- Temperature: -40°C to 120°C
- Power: -30kW to 30kW
- Percentage: 0% to 100%
- Flow: 0-5000 l/h
- Pressure: Physical limits per unit

### Database Reliability
- Automatic table creation on startup
- Foreign key constraints enabled
- Indexes for fast queries
- Transaction support for data consistency

## Performance Characteristics

| Operation | Performance | Notes |
|-----------|-------------|-------|
| WebSocket reconnect | <30s max | Exponential backoff |
| YAML scan (10 registers) | ~200ms | With 20ms inter-register delay |
| Raw range scan (100 regs) | ~2s | With batching of 10 |
| CSV export (10k rows) | <1s | Streaming generation |
| Graph rendering | <100ms | With 100 data points |
| Auto-scale calculation | <10ms | Per chart update |

## Security Considerations

1. **Input Validation**
   - IP address format validation
   - Port range checking (1-65535)
   - Register address bounds checking

2. **Modbus Security**
   - Timeout on all connections (3 seconds)
   - Graceful error handling
   - No authentication (add if needed)

3. **Database Security**
   - SQLite file permissions
   - No SQL injection (parameterized queries)
   - No hardcoded credentials

4. **WebSocket Security**
   - WSS recommended for production
   - CORS validation
   - Message validation

## Future Enhancements

1. **Authentication & Authorization**
   - User login system
   - Role-based access control
   - Device access permissions

2. **Advanced Analytics**
   - Historical trend analysis
   - Anomaly detection
   - Predictive alerts

3. **Multi-Device Support**
   - Parallel scanning of multiple devices
   - Device groups and profiles
   - Cross-device correlations

4. **Mobile App**
   - React Native mobile application
   - Offline data caching
   - Push notifications

5. **Cloud Integration**
   - AWS/Azure backend
   - Time-series database (InfluxDB)
   - Machine learning pipeline
