/**
 * Connection Manager with Exponential Backoff Retry
 *
 * Features:
 *   - Automatic reconnection with exponential backoff
 *   - Connection state tracking (connected, connecting, disconnected, error)
 *   - Last connection time tracking
 *   - User notifications for connection events
 */

"use strict";

class ConnectionManager {
  constructor(options = {}) {
    this.url = options.url || `ws://${window.location.host}`;
    this.maxRetries = options.maxRetries || 10;
    this.initialDelay = options.initialDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 30000; // 30 seconds

    this.ws = null;
    this.state = "disconnected"; // disconnected, connecting, connected, error
    this.lastConnectTime = null;
    this.retryCount = 0;
    this.retryTimeout = null;
    this.messageHandlers = [];
    this.stateChangeHandlers = [];
  }

  /**
   * Connect with automatic retry logic
   */
  connect() {
    if (this.state === "connecting" || this.state === "connected") {
      return Promise.resolve();
    }

    this.setState("connecting");

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.lastConnectTime = new Date();
          this.retryCount = 0;
          this.setState("connected");
          console.log("[ConnectionManager] Connected");
          resolve();
        };

        this.ws.onmessage = (e) => {
          this.messageHandlers.forEach((handler) => handler(e.data));
        };

        this.ws.onerror = (err) => {
          console.error("[ConnectionManager] WebSocket error:", err);
          this.setState("error");
          reject(err);
        };

        this.ws.onclose = () => {
          this.setState("disconnected");
          this.attemptReconnect();
        };
      } catch (err) {
        this.setState("error");
        reject(err);
      }
    });
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  attemptReconnect() {
    if (this.retryCount >= this.maxRetries) {
      this.setState("error");
      console.error(
        `[ConnectionManager] Max retries (${this.maxRetries}) exceeded`
      );
      return;
    }

    const delay = Math.min(
      this.initialDelay * Math.pow(2, this.retryCount),
      this.maxDelay
    );
    this.retryCount++;

    console.log(
      `[ConnectionManager] Retrying in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`
    );

    this.retryTimeout = setTimeout(() => {
      this.connect().catch(() => {
        // Error handled in onclose
      });
    }, delay);
  }

  /**
   * Send message via WebSocket
   */
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
  }

  /**
   * Register message handler
   */
  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  /**
   * Register state change handler
   */
  onStateChange(handler) {
    this.stateChangeHandlers.push(handler);
  }

  /**
   * Update state and notify handlers
   */
  setState(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      console.log(`[ConnectionManager] State: ${oldState} → ${newState}`);
      this.stateChangeHandlers.forEach((handler) => handler(newState, oldState));
    }
  }

  /**
   * Disconnect gracefully
   */
  disconnect() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /**
   * Get connection status summary
   */
  getStatus() {
    return {
      state: this.state,
      lastConnectTime: this.lastConnectTime,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      isConnected: this.state === "connected",
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = ConnectionManager;
}
