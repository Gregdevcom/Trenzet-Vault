// server.js - WebSocket signaling server for WebRTC with reconnection support
const clientMuteStatus = new Map(); // client WebSocket -> boolean (isMuted)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from current directory
app.use(express.static("."));

// ✨ NEW: API endpoint to check if a room exists
app.get("/api/check-room", (req, res) => {
  // Get the roomId from the URL query parameter
  // Example: /api/check-room?roomId=abc123
  // req.query.roomId will be "abc123"
  const roomId = req.query.roomId;

  // Check if this room was properly created
  const exists = validRooms.has(roomId);

  // Send back a JSON response
  // This is like the server saying "yes" or "no"
  res.json({ exists: exists });
});

// Store connected clients and room information
const rooms = new Map(); // roomId -> Set of client WebSockets
const clientRooms = new Map(); // client WebSocket -> roomId
const validRooms = new Set();
// Heartbeat to detect disconnected clients
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Clean up any closed/dead connections from a room
function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Find and remove any dead connections
  room.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      room.delete(client);
      clientRooms.delete(client);
    }
  });

  // If room is now empty, delete it entirely
  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

wss.on("connection", (ws) => {
  // Setup heartbeat
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case "create-room": // ✨ NEW
          handleCreateRoom(ws, data.roomId);
          break;
        case "join":
          handleJoin(ws, data.roomId);
          break;

        case "offer":
          broadcastToRoom(ws, data);
          break;

        case "answer":
          broadcastToRoom(ws, data);
          break;

        case "ice-candidate":
          broadcastToRoom(ws, data);
          break;

        case "restart":
          broadcastToRoom(ws, data);
          break;

        case "check-peer":
          broadcastToRoom(ws, data);
          break;

        case "peer-ready":
          broadcastToRoom(ws, data);
          break;

        case "mute-status":
          // 🆕 Store the mute status for this client
          clientMuteStatus.set(ws, data.isMuted);
          console.log(`🎤 User mute status updated: ${data.isMuted}`);
          broadcastToRoom(ws, data);
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch {}
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      handleDisconnect(ws);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

// Create a new room (only called by room creator)
function handleCreateRoom(ws, roomId) {
  console.log(`🏠 Creating room: ${roomId}`);
  // Mark this room as valid
  validRooms.add(roomId);
  console.log(`✅ Valid rooms:`, Array.from(validRooms));

  // Now join the room
  handleJoin(ws, roomId);
}
// Handle client joining a room
function handleJoin(ws, roomId) {
  console.log(`👤 User attempting to join room: ${roomId}`);

  // Leave current room if in one
  handleDisconnect(ws);

  // Check if room is valid (was properly created)
  if (!validRooms.has(roomId)) {
    console.log(`❌ Room ${roomId} does not exist in validRooms`);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Room does not exist",
        redirect: true,
      })
    );
    return;
  }

  console.log(`✅ Room ${roomId} is valid`);

  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`📦 Created new room Map entry for ${roomId}`);
  }

  const room = rooms.get(roomId);

  // ✅ IMPROVED: More aggressive cleanup of dead connections
  const deadConnections = [];
  room.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      deadConnections.push(client);
    }
  });

  deadConnections.forEach((client) => {
    console.log(`🧹 Removing dead connection from room`);
    room.delete(client);
    clientRooms.delete(client);
  });

  console.log(`🧹 After cleanup, room size: ${room.size}`);

  // Check if room is full (limit to 2 users for 1-on-1 call)
  if (room.size >= 2) {
    console.log(`⛔ Room ${roomId} is full`);
    ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
    return;
  }

  const isInitiator = room.size === 0;
  console.log(
    `🎯 User is initiator: ${isInitiator}, room size before add: ${room.size}`
  );

  // Add client to room
  room.add(ws);
  clientRooms.set(ws, roomId);
  console.log(`➕ Added user to room. New room size: ${room.size}`);

  // Notify client they joined successfully
  ws.send(
    JSON.stringify({
      type: "joined",
      roomId: roomId,
      isInitiator: isInitiator,
    })
  );
  console.log(`📤 Sent 'joined' to user. isInitiator: ${isInitiator}`);

  // If second person joined, notify BOTH clients
  if (room.size === 2) {
    // 🆕 Get both clients as an array
    const clients = Array.from(room);
    const firstUser = clients[0];
    const secondUser = clients[1];

    console.log(`🎉 Room is full! Sending 'ready' to both users`);
    room.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "ready" }));
        console.log(`📤 Sent 'ready' to a client`);
      }
    });
    // 🆕 Send first user's mute status to second user
    if (
      clientMuteStatus.has(firstUser) &&
      secondUser.readyState === WebSocket.OPEN
    ) {
      const firstUserMuted = clientMuteStatus.get(firstUser);
      secondUser.send(
        JSON.stringify({
          type: "mute-status",
          isMuted: firstUserMuted,
        })
      );
      console.log(
        `📤 Sent first user's mute status (${firstUserMuted}) to second user`
      );
    }
  }
  // 🆕 Send second user's mute status to first user
  if (
    clientMuteStatus.has(secondUser) &&
    firstUser.readyState === WebSocket.OPEN
  ) {
    const secondUserMuted = clientMuteStatus.get(secondUser);
    firstUser.send(
      JSON.stringify({
        type: "mute-status",
        isMuted: secondUserMuted,
      })
    );
    console.log(
      `📤 Sent second user's mute status (${secondUserMuted}) to first user`
    );
  }
}

// Broadcast message to all other clients in the same room
function broadcastToRoom(sender, data) {
  const roomId = clientRooms.get(sender);

  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  // Send to all clients in room except sender
  room.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}
// Handle client disconnect
function handleDisconnect(ws) {
  const roomId = clientRooms.get(ws);

  if (roomId) {
    const room = rooms.get(roomId);

    if (room) {
      room.delete(ws);
      console.log(`👋 User disconnected from room ${roomId}`);

      // Notify other clients in room
      room.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "peer-disconnected" }));
          console.log(`📤 Notified remaining user of disconnection`);
        }
      });

      // Delete room if empty
      if (room.size === 0) {
        rooms.delete(roomId);
        validRooms.delete(roomId);
        console.log(`🗑️ Room ${roomId} deleted (empty)`);
      }
    }

    clientRooms.delete(ws);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
