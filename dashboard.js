/**
 * Dashboard - Real-time Monitoring & Analytics
 *
 * Features:
 *   - Connection status display with auto-reconnect info
 *   - Real-time line graphs for temperature tags
 *   - Auto-scaling graphs
 *   - Data export button (CSV/JSON)
 *   - Live reading display
 */

"use strict";

// Include Chart.js for graphing
const CHART_JS_URL =
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";

class Dashboard {
  constructor(options = {}) {
    this.connectionManager = options.connectionManager;
    this.dataStore = options.dataStore || {}; // Local data cache
    this.chartConfigs = {};
    this.charts = {};
    this.readings = {}; // { tagName: [readings...] }
    this.maxHistoryPoints = options.maxHistoryPoints || 100;
    this.updateInterval = options.updateInterval || 1000;
    this.updateTimer = null;
  }

  /**
   * Initialize dashboard UI
   */
  async init() {
    // Load Chart.js
    if (!window.Chart) {
      await this.loadChartJs();
    }

    this.renderUI();
    this.setupEventHandlers();
    this.setupConnectionMonitoring();
    this.startUpdates();
  }

  /**
   * Load Chart.js library
   */
  loadChartJs() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHART_JS_URL;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Render main dashboard HTML
   */
  renderUI() {
    const container = document.getElementById("dashboard") || document.body;

    container.innerHTML = `
      <div class="dashboard-container">
        <!-- Connection Status Bar -->
        <div class="connection-status-bar">
          <div class="status-indicator" id="statusIndicator"></div>
          <div class="status-info">
            <span id="statusText">Disconnected</span>
            <span id="statusTime" class="status-time"></span>
          </div>
          <div class="status-actions">
            <button id="exportBtn" class="btn-primary">📥 Export Data</button>
            <button id="simulateBtn" class="btn-secondary">🔄 Use Simulator</button>
          </div>
        </div>

        <!-- Main Content -->
        <div class="dashboard-content">
          <!-- Sidebar: Connection & Settings -->
          <div class="sidebar">
            <div class="panel">
              <h3>Connection</h3>
              <div class="connection-details">
                <div class="detail-row">
                  <label>Status:</label>
                  <span id="connStatus" class="value">Disconnected</span>
                </div>
                <div class="detail-row">
                  <label>Last Connect:</label>
                  <span id="lastConnect" class="value">Never</span>
                </div>
                <div class="detail-row">
                  <label>Retry Attempt:</label>
                  <span id="retryAttempt" class="value">0</span>
                </div>
                <div class="detail-row">
                  <label>Readings Stored:</label>
                  <span id="readingCount" class="value">0</span>
                </div>
              </div>
            </div>

            <div class="panel">
              <h3>Device Settings</h3>
              <div class="form-group">
                <label>IP Address</label>
                <input
                  type="text"
                  id="deviceIp"
                  value="127.0.0.1"
                  placeholder="192.168.1.40"
                />
              </div>
              <div class="form-group">
                <label>Port</label>
                <input
                  type="number"
                  id="devicePort"
                  value="5020"
                  placeholder="502"
                />
              </div>
              <div class="form-group">
                <label>Unit ID</label>
                <input
                  type="number"
                  id="deviceUnitId"
                  value="1"
                  placeholder="1"
                />
              </div>
              <button id="connectBtn" class="btn-primary btn-block">Connect</button>
            </div>
          </div>

          <!-- Main: Graphs & Data -->
          <div class="main-content">
            <!-- Temperature Graphs Section -->
            <div class="section">
              <h2>Temperature Monitoring</h2>
              <div class="charts-grid" id="chartsContainer"></div>
            </div>

            <!-- Live Data Table -->
            <div class="section">
              <h2>Latest Readings</h2>
              <table class="readings-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Tag Name</th>
                    <th>Section</th>
                    <th>Value</th>
                    <th>Unit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="readingsTableBody">
                  <tr>
                    <td colspan="6" class="empty">No data yet. Connect to start.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Export Modal -->
      <div class="modal" id="exportModal">
        <div class="modal-content">
          <h2>Export Data</h2>
          <div class="export-options">
            <button class="btn-secondary" data-format="csv">📊 CSV (Excel)</button>
            <button class="btn-secondary" data-format="json">📝 JSON</button>
          </div>
          <p class="help-text">Select format to download all stored readings</p>
          <button class="btn-close" id="closeExportModal">Close</button>
        </div>
      </div>

      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          min-height: 100vh;
          padding: 10px;
        }

        .dashboard-container {
          max-width: 1400px;
          margin: 0 auto;
        }

        /* Connection Status Bar */
        .connection-status-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          background: white;
          border-radius: 8px;
          padding: 15px 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          border-left: 4px solid #ddd;
        }

        .connection-status-bar.connected {
          border-left-color: #4caf50;
        }

        .connection-status-bar.connecting {
          border-left-color: #ff9800;
        }

        .connection-status-bar.error {
          border-left-color: #f44336;
        }

        .status-indicator {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #9e9e9e;
          animation: pulse 2s infinite;
        }

        .status-indicator.connected {
          background: #4caf50;
          animation: none;
        }

        .status-indicator.connecting {
          background: #ff9800;
        }

        .status-indicator.error {
          background: #f44336;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .status-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .status-time {
          font-size: 12px;
          color: #666;
        }

        .status-actions {
          display: flex;
          gap: 10px;
        }

        /* Layout */
        .dashboard-content {
          display: flex;
          gap: 20px;
        }

        .sidebar {
          width: 280px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* Panels */
        .panel {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .panel h3 {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 15px;
          text-transform: uppercase;
          color: #666;
        }

        .connection-details {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          padding: 8px;
          background: #f8f8f8;
          border-radius: 4px;
        }

        .detail-row label {
          font-weight: 600;
          color: #333;
        }

        .detail-row .value {
          color: #4caf50;
          font-weight: 500;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Forms */
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-bottom: 12px;
        }

        .form-group label {
          font-size: 12px;
          font-weight: 600;
          color: #666;
        }

        .form-group input {
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 13px;
        }

        .form-group input:focus {
          outline: none;
          border-color: #4caf50;
          box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
        }

        /* Buttons */
        .btn-primary,
        .btn-secondary,
        .btn-close {
          padding: 10px 16px;
          border: none;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #4caf50;
          color: white;
        }

        .btn-primary:hover {
          background: #45a049;
        }

        .btn-secondary {
          background: #2196f3;
          color: white;
        }

        .btn-secondary:hover {
          background: #0b7dda;
        }

        .btn-close {
          background: #9e9e9e;
          color: white;
        }

        .btn-close:hover {
          background: #757575;
        }

        .btn-block {
          width: 100%;
        }

        /* Sections */
        .section {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .section h2 {
          font-size: 18px;
          margin-bottom: 15px;
          color: #333;
        }

        /* Charts Grid */
        .charts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
        }

        .chart-card {
          background: #f9f9f9;
          border-radius: 6px;
          padding: 15px;
          border: 1px solid #eee;
        }

        .chart-card h4 {
          font-size: 14px;
          margin-bottom: 10px;
          color: #333;
        }

        .chart-card canvas {
          max-height: 250px;
        }

        /* Table */
        .readings-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .readings-table thead {
          background: #f5f5f5;
          border-bottom: 2px solid #ddd;
        }

        .readings-table th {
          padding: 12px;
          text-align: left;
          font-weight: 600;
          color: #333;
        }

        .readings-table td {
          padding: 12px;
          border-bottom: 1px solid #eee;
        }

        .readings-table tbody tr:hover {
          background: #f9f9f9;
        }

        .readings-table .empty {
          text-align: center;
          color: #999;
        }

        .status-ok {
          color: #4caf50;
          font-weight: 600;
        }

        .status-warn {
          color: #ff9800;
          font-weight: 600;
        }

        .status-error {
          color: #f44336;
          font-weight: 600;
        }

        /* Modal */
        .modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.4);
        }

        .modal.show {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-content {
          background: white;
          padding: 30px;
          border-radius: 8px;
          text-align: center;
          max-width: 400px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }

        .modal-content h2 {
          margin-bottom: 20px;
          color: #333;
        }

        .export-options {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .export-options button {
          flex: 1;
        }

        .help-text {
          font-size: 12px;
          color: #666;
          margin-bottom: 20px;
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .dashboard-content {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
          }

          .charts-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Connection button
    document.getElementById("connectBtn").addEventListener("click", () => {
      const ip = document.getElementById("deviceIp").value;
      const port = parseInt(document.getElementById("devicePort").value);
      const unitId = parseInt(document.getElementById("deviceUnitId").value);
      this.connect(ip, port, unitId);
    });

    // Export button
    document.getElementById("exportBtn").addEventListener("click", () => {
      this.showExportModal();
    });

    // Export modal buttons
    document.querySelectorAll(".export-options button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const format = e.target.dataset.format;
        this.exportData(format);
        this.closeExportModal();
      });
    });

    // Close export modal
    document.getElementById("closeExportModal").addEventListener("click", () => {
      this.closeExportModal();
    });

    // Simulator button
    document.getElementById("simulateBtn").addEventListener("click", () => {
      this.enableSimulator();
    });
  }

  /**
   * Setup connection monitoring
   */
  setupConnectionMonitoring() {
    if (!this.connectionManager) return;

    this.connectionManager.onStateChange((newState, oldState) => {
      this.updateConnectionStatus();
    });
  }

  /**
   * Update connection status display
   */
  updateConnectionStatus() {
    if (!this.connectionManager) return;

    const status = this.connectionManager.getStatus();
    const statusBar = document.querySelector(".connection-status-bar");
    const statusIndicator = document.querySelector(".status-indicator");
    const statusText = document.getElementById("statusText");
    const connStatus = document.getElementById("connStatus");
    const lastConnect = document.getElementById("lastConnect");
    const retryAttempt = document.getElementById("retryAttempt");

    // Update indicator
    statusIndicator.className = `status-indicator ${status.state}`;

    // Update status bar class
    statusBar.className = `connection-status-bar ${status.state}`;

    // Update status text
    const stateText = {
      connected: "✅ Connected",
      connecting: "🔄 Connecting...",
      disconnected: "❌ Disconnected",
      error: "⚠️  Connection Error",
    }[status.state];

    statusText.textContent = stateText;
    connStatus.textContent = status.state.toUpperCase();

    // Update last connect time
    if (status.lastConnectTime) {
      const time = new Date(status.lastConnectTime);
      lastConnect.textContent = time.toLocaleTimeString();
    }

    // Update retry attempt
    retryAttempt.textContent = `${status.retryCount}/${status.maxRetries}`;

    // Show retry info in status bar
    if (status.state === "connecting" && status.retryCount > 0) {
      document.querySelector(".status-time").textContent = `Retrying (${status.retryCount}/${status.maxRetries})`;
    } else if (status.state === "error") {
      document.querySelector(".status-time").textContent = "Max retries exceeded";
    } else {
      document.querySelector(".status-time").textContent = "";
    }
  }

  /**
   * Connect to device
   */
  async connect(ip, port, unitId) {
    if (!this.connectionManager) {
      alert("Connection manager not available");
      return;
    }

    try {
      await this.connectionManager.connect();
      const scanId = "scan_" + Date.now();

      // Send scan request
      this.connectionManager.send({
        type: "scan_yaml",
        id: scanId,
        ip,
        port,
        unitId,
      });
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
    }
  }

  /**
   * Record reading
   */
  recordReading(reading) {
    const tagName = reading.name || `REG_${reading.register}`;

    if (!this.readings[tagName]) {
      this.readings[tagName] = [];
    }

    this.readings[tagName].push({
      timestamp: new Date(),
      value: reading.scaledValue || reading.value,
      raw: reading.raw,
      sanity: reading.sanity,
    });

    // Keep only last N points
    if (this.readings[tagName].length > this.maxHistoryPoints) {
      this.readings[tagName].shift();
    }

    // Update table
    this.updateReadingsTable(reading);

    // Create or update chart
    if (reading.unit === "°C" || reading.unit.includes("Temperature")) {
      this.updateTemperatureChart(tagName, reading);
    }
  }

  /**
   * Update temperature chart
   */
  updateTemperatureChart(tagName, reading) {
    const chartId = `chart_${tagName}`;
    let chartCanvas = document.getElementById(chartId);

    if (!chartCanvas) {
      // Create new chart card
      const chartsContainer = document.getElementById("chartsContainer");
      const chartCard = document.createElement("div");
      chartCard.className = "chart-card";
      chartCard.innerHTML = `
        <h4>${tagName.replace(/_/g, " ")}</h4>
        <canvas id="${chartId}"></canvas>
      `;
      chartsContainer.appendChild(chartCard);
      chartCanvas = document.getElementById(chartId);
    }

    const data = this.readings[tagName] || [];
    const labels = data.map((r) => r.timestamp.toLocaleTimeString());
    const values = data.map((r) => r.value);

    // Auto-scale
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const padding = (maxVal - minVal) * 0.1 || 1;

    if (!this.charts[chartId]) {
      // Create new chart
      this.charts[chartId] = new Chart(chartCanvas, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: `${tagName} (${reading.unit})`,
              data: values,
              borderColor: "#4caf50",
              backgroundColor: "rgba(76, 175, 80, 0.1)",
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: "#4caf50",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: true },
          },
          scales: {
            y: {
              min: minVal - padding,
              max: maxVal + padding,
              title: { display: true, text: reading.unit },
            },
          },
        },
      });
    } else {
      // Update existing chart
      const chart = this.charts[chartId];
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.options.scales.y.min = minVal - padding;
      chart.options.scales.y.max = maxVal + padding;
      chart.update();
    }
  }

  /**
   * Update readings table
   */
  updateReadingsTable(reading) {
    const tbody = document.getElementById("readingsTableBody");
    const tagName = reading.name || `REG_${reading.register}`;

    // Remove empty row
    const emptyRow = tbody.querySelector(".empty")?.parentElement;
    if (emptyRow) emptyRow.remove();

    // Find or create row for this tag
    let row = Array.from(tbody.rows).find((r) => r.dataset.tag === tagName);
    if (!row) {
      row = tbody.insertRow();
      row.dataset.tag = tagName;
    }

    const statusClass =
      reading.sanity?.status === "ok"
        ? "status-ok"
        : reading.sanity?.status === "warn"
        ? "status-warn"
        : "status-error";

    row.innerHTML = `
      <td>${new Date().toLocaleTimeString()}</td>
      <td>${tagName}</td>
      <td>${reading.section || ""}</td>
      <td>${(reading.scaledValue || reading.value).toFixed(2)}</td>
      <td>${reading.unit || ""}</td>
      <td class="${statusClass}">${reading.sanity?.status || "unknown"}</td>
    `;

    // Update reading count
    document.getElementById("readingCount").textContent = tbody.rows.length;
  }

  /**
   * Show export modal
   */
  showExportModal() {
    document.getElementById("exportModal").classList.add("show");
  }

  /**
   * Close export modal
   */
  closeExportModal() {
    document.getElementById("exportModal").classList.remove("show");
  }

  /**
   * Export data
   */
  exportData(format) {
    if (format === "csv") {
      this.exportCSV();
    } else if (format === "json") {
      this.exportJSON();
    }
  }

  /**
   * Export as CSV
   */
  exportCSV() {
    const rows = [];
    rows.push(
      "Timestamp,Tag Name,Value,Unit,Status,Sanity Reason"
    );

    Object.entries(this.readings).forEach(([tagName, data]) => {
      data.forEach((reading) => {
        rows.push(
          `"${reading.timestamp.toISOString()}","${tagName}",${reading.value},"","${reading.sanity?.status}","${reading.sanity?.reason}"`
        );
      });
    });

    const csv = rows.join("\n");
    this.downloadFile(csv, "modbus_readings.csv", "text/csv");
  }

  /**
   * Export as JSON
   */
  exportJSON() {
    const data = {};
    Object.entries(this.readings).forEach(([tagName, readings]) => {
      data[tagName] = readings;
    });

    const json = JSON.stringify(data, null, 2);
    this.downloadFile(json, "modbus_readings.json", "application/json");
  }

  /**
   * Download file
   */
  downloadFile(content, filename, contentType) {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      `data:${contentType};charset=utf-8,${encodeURIComponent(content)}`
    );
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  /**
   * Enable simulator
   */
  enableSimulator() {
    // Load simulator if not loaded
    if (!window.DataSimulator) {
      const script = document.createElement("script");
      script.src = "data-simulator.js";
      script.onload = () => {
        this.initSimulator();
      };
      document.head.appendChild(script);
    } else {
      this.initSimulator();
    }
  }

  /**
   * Initialize simulator
   */
  initSimulator() {
    const simulator = new DataSimulator();
    simulator.start();

    // Send simulated readings
    setInterval(() => {
      const readings = simulator.getAllReadings("127.0.0.1", 5020, 1);
      readings.forEach((reading) => {
        this.recordReading(reading);
      });
    }, 2000);

    alert("Simulator enabled! Generating test data...");
  }

  /**
   * Start dashboard updates
   */
  startUpdates() {
    this.updateTimer = setInterval(() => {
      this.updateConnectionStatus();
    }, 1000);
  }

  /**
   * Stop dashboard updates
   */
  stopUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = Dashboard;
}
