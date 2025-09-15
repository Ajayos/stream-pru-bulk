/**
 * CODE BY AJAY O S
 *
 * WebSocket Client Module
 * Handles all WebSocket communication and message processing
 */
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.userId = this.generateUserId();

    // Bind methods to preserve 'this' context
    this.handleOpen = this.handleOpen.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleClose = this.handleClose.bind(this);
  }

  /**
   * Initialize WebSocket connection
   */
  connect() {
    try {
      const url = this.getWebSocketUrl();
      console.log(`WebSocket connecting to: ${url}`);

      this.ws = new WebSocket(url);
      this.ws.addEventListener("open", this.handleOpen);
      this.ws.addEventListener("message", this.handleMessage);
      this.ws.addEventListener("error", this.handleError);
      this.ws.addEventListener("close", this.handleClose);
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.removeEventListener("open", this.handleOpen);
      this.ws.removeEventListener("message", this.handleMessage);
      this.ws.removeEventListener("error", this.handleError);
      this.ws.removeEventListener("close", this.handleClose);
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Send message through WebSocket
   */
  send(message) {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      console.error("WebSocket not connected");
      this.emit("error", { message: "WebSocket not connected" });
      return false;
    }

    try {
      const payload =
        typeof message === "string" ? message : JSON.stringify(message);
      this.ws.send(payload);

      this.emit("messageOut", {
        type: message.event || message.type,
        payload: message,
      });

      return true;
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
      this.emit("error", { message: "Failed to send message", error });
      return false;
    }
  }

  /**
   * Register message handler
   */
  on(eventType, handler) {
    if (!this.messageHandlers.has(eventType)) {
      this.messageHandlers.set(eventType, []);
    }
    this.messageHandlers.get(eventType).push(handler);
  }

  /**
   * Unregister message handler
   */
  off(eventType, handler) {
    if (this.messageHandlers.has(eventType)) {
      const handlers = this.messageHandlers.get(eventType);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to handlers
   */
  emit(eventType, data) {
    if (this.messageHandlers.has(eventType)) {
      this.messageHandlers.get(eventType).forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error);
        }
      });
    }
  }

  /**
   * Handle WebSocket open
   */
  handleOpen(event) {
    console.log("WebSocket connection established");
    this.isConnected = true;
    this.reconnectAttempts = 0;

    // Register user with server
    this.registerUser();

    this.emit("connected", {
      timestamp: new Date().toISOString(),
      userId: this.userId,
    });
  }

  /**
   * Handle WebSocket message
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const { event: eventType, ...data } = message;

      this.emit("messageIn", {
        type: eventType,
        payload: message,
      });

      // Route message to specific handlers
      this.routeMessage(eventType, data);
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error, event.data);
      this.emit("parseError", {
        error: error.message,
        rawData: event.data,
      });
    }
  }

  /**
   * Handle WebSocket error
   */
  handleError(event) {
    console.error("WebSocket error:", event);
    this.emit("error", {
      message: "WebSocket connection error",
      event,
    });
  }

  /**
   * Handle WebSocket close
   */
  handleClose(event) {
    console.log("WebSocket connection closed:", event.code, event.reason);
    this.isConnected = false;

    this.emit("disconnected", {
      code: event.code,
      reason: event.reason,
      timestamp: new Date().toISOString(),
    });

    // Attempt to reconnect if not manually closed
    if (event.code !== 1000 && event.code !== 1001) {
      this.scheduleReconnect();
    }
  }

  /**
   * Route messages to appropriate handlers
   */
  routeMessage(eventType, data) {
    const normalizedEvent = eventType?.toLowerCase()?.trim();

    switch (normalizedEvent) {
      case "add-stream":
        this.emit("streamsAdded", data);
        break;
      case "remove-stream":
        this.emit("streamRemoved", data);
        break;
      case "media":
        this.emit("audioData", data);
        break;
      case "file-upload-response":
        this.emit("fileUploadResponse", data);
        break;
      case "dtmf":
        this.emit("dtmf", data);
        break;
      case "error":
        this.emit("serverError", data);
        break;
      default:
        this.emit("unknownMessage", { eventType, data });
    }
  }

  /**
   * Register user with server
   */
  registerUser() {
    const registerMessage = {
      event: "register-user",
      id: this.userId,
      name: "Professional Client",
    };

    this.send(registerMessage);
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      this.emit("maxReconnectAttemptsReached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    console.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`
    );

    setTimeout(() => {
      if (!this.isConnected) {
        console.log(`Reconnection attempt ${this.reconnectAttempts}`);
        this.connect();
      }
    }, delay);
  }

  /**
   * Get WebSocket URL based on current environment
   */
  getWebSocketUrl() {
    const { hostname, protocol, host } = window.location;

    if (["localhost", "127.0.0.1"].includes(hostname)) {
      return "wss://stream.ajayos.in/?ptpl=Ptpl123";
    } else {
      const wsProtocol = protocol.replace("http", "ws");
      return `${wsProtocol}//${host}?ptpl=Ptpl123`;
    }
  }

  /**
   * Generate unique user ID
   */
  generateUserId() {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: this.ws ? this.ws.readyState : WebSocket.CLOSED,
      userId: this.userId,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Send specific message types
   */
  joinRoom(roomId) {
    return this.send({
      event: "join-room",
      room_id: roomId,
    });
  }

  leaveRoom(roomId) {
    return this.send({
      event: "leave-room",
      room_id: roomId,
    });
  }

  clearStream(roomId) {
    return this.send({
      event: "clear",
      room_id: roomId,
    });
  }

  markStream(roomId, label = "<label>") {
    return this.send({
      event: "mark",
      sequence_number: 15,
      room_id: roomId,
      mark: {
        name: label,
      },
    });
  }

  uploadAudioChunk(uploadData) {
    return this.send({
      event: "audio-upload",
      ...uploadData,
    });
  }
}

// Export for use in main application
if (typeof module !== "undefined" && module.exports) {
  module.exports = WebSocketClient;
} else {
  window.WebSocketClient = WebSocketClient;
}
