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

## Docker

Docker Desktop is supported on macOS and Windows. Build and start the persistent server with:

```bash
docker build -t modbusscanner:local .
docker volume create modbusscanner-data
docker run --rm --name modbusscanner \
	-p 8080:8080 \
	-v modbusscanner-data:/data \
	modbusscanner:local
```

Open **http://localhost:8080**. Stop the container with `Ctrl+C`; the SQLite database remains in the Docker volume. Docker Desktop must be allowed to reach the Modbus device's network, VPN, and firewall. On Windows PowerShell, use the same commands without changing the port mapping.

The published images are available as:

```bash
docker pull ghcr.io/OWNER/modbusscanner:latest
docker pull DOCKERHUB_USERNAME/modbusscanner:latest
```

Replace the placeholders with the GitHub owner and Docker Hub username.

Run the local checks with:

```bash
npm ci
npm run test:all
```

## SonarQube and IDE Integration

Install the **SonarQube for IDE** extension in VS Code (`SonarSource.sonarlint-vscode`). It provides local analysis while editing. For connected mode, configure the extension with the same SonarQube server used by CI and bind this workspace to the project key `fishbeef_modbusscanner`.

The GitHub Actions workflow runs the `sonarqube` job after the tests. Configure these repository Actions secrets before enabling the check:

- `SONAR_HOST_URL`: URL of the SonarQube Server, for example `https://sonarqube.example.com`
- `SONAR_TOKEN`: project analysis token with permission to execute analysis
- Repository variable `SONARQUBE_ENABLED=true`: enables the scan after a self-hosted runner with the labels `self-hosted`, `linux`, and `sonarqube` is registered.

The workflow uses the repository configuration in `sonar-project.properties`. Add the `sonarqube` check to the required status checks for `main` after its first successful run.

The SonarQube server is not required to be publicly reachable. The self-hosted runner must be able to reach it on the private network, while the runner only needs outbound HTTPS access to GitHub. Docker Hub publishing is optional and is skipped until `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are configured.

## Protecting `main`

Configure the `main` branch in GitHub repository settings with these rules:

- Require a pull request before merging.
- Require at least one approving review and dismiss stale approvals.
- Require the `test` status check from the `CI` workflow.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Enforce the rules for administrators.

GitHub rejected automatic activation for the current private repository because branch protection requires GitHub Pro or a public repository on the current plan.

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
