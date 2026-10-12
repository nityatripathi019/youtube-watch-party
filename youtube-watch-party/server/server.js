const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN ||
  "https://youtube-watch-party-frontend-5dmm.onrender.com";

app.use(cors({
  origin: CLIENT_ORIGIN,
  methods: ["GET", "POST"]
}));

app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});


// In-memory MVP: rooms disappear when the server restarts.
const rooms = new Map();

app.get("/", (_req, res) => {
  res.json({ message: "YouTube Watch Party API is running" });
});

function makeRoomId() {
  let id;
  do {
    id = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(id));
  return id;
}

function safeUsername(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 24);
}

function getRoomState(room) {
  return {
    videoId: room.videoId,
    playState: room.playState,
    currentTime: room.currentTime,
    updatedAt: room.updatedAt
  };
}

function getParticipants(room) {
  return [...room.participants.entries()].map(([userId, user]) => ({
    userId,
    username: user.username,
    role: user.role
  }));
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("sync_state", getRoomState(room));
  io.to(roomId).emit("participants_updated", getParticipants(room));
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  socket.leave(roomId);
  socket.data.roomId = null;

  if (!room) return;
  room.participants.delete(socket.id);

  if (room.hostId === socket.id) {
    // MVP policy: close the room if the host leaves.
    rooms.delete(roomId);
    io.to(roomId).emit("room_closed", {
      message: "The host left. This room is now closed."
    });
    return;
  }

  broadcastRoom(roomId);
}

function reply(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function getJoinedRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return { error: "Join a room first." };
  const room = rooms.get(roomId);
  if (!room) return { error: "Room not found." };
  const user = room.participants.get(socket.id);
  if (!user) return { error: "You are not a participant in this room." };
  return { roomId, room, user };
}

function canControl(user) {
  return user.role === "Host" || user.role === "Moderator";
}

function extractVideoId(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (/^[\w-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname)) {
      const id = url.searchParams.get("v");
      if (id && /^[\w-]{11}$/.test(id)) return id;
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (marker >= 0 && parts[marker + 1] && /^[\w-]{11}$/.test(parts[marker + 1])) {
        return parts[marker + 1];
      }
    }
  } catch (_error) {
    return null;
  }
  return null;
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create_room", ({ username } = {}, callback) => {
    const name = safeUsername(username);
    if (!name) return reply(callback, { error: "Please enter a username." });

    leaveCurrentRoom(socket);
    const roomId = makeRoomId();
    const room = {
      hostId: socket.id,
      videoId: "M7lc1UVf-VE",
      playState: false,
      currentTime: 0,
      updatedAt: Date.now(),
      participants: new Map()
    };
    room.participants.set(socket.id, { username: name, role: "Host" });
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;

    reply(callback, {
      success: true,
      roomId,
      role: "Host",
      state: getRoomState(room),
      participants: getParticipants(room)
    });
    broadcastRoom(roomId);
  });

  socket.on("join_room", ({ roomId, username } = {}, callback) => {
    const name = safeUsername(username);
    const normalizedId = typeof roomId === "string" ? roomId.trim().toUpperCase() : "";
    const room = rooms.get(normalizedId);
    if (!name) return reply(callback, { error: "Please enter a username." });
    if (!room) return reply(callback, { error: "Room not found. Check the room code." });

    leaveCurrentRoom(socket);
    room.participants.set(socket.id, { username: name, role: "Participant" });
    socket.join(normalizedId);
    socket.data.roomId = normalizedId;

    reply(callback, {
      success: true,
      roomId: normalizedId,
      role: "Participant",
      state: getRoomState(room),
      participants: getParticipants(room)
    });
    socket.to(normalizedId).emit("user_joined", { username: name });
    broadcastRoom(normalizedId);
  });

  socket.on("leave_room", (callback) => {
    leaveCurrentRoom(socket);
    reply(callback, { success: true });
  });

  socket.on("play", (callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (!canControl(result.user)) {
      socket.emit("permission_denied", { message: "Only Host or Moderator can control playback." });
      return reply(callback, { error: "Permission denied." });
    }
    result.room.playState = true;
    result.room.updatedAt = Date.now();
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  socket.on("pause", (callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (!canControl(result.user)) {
      socket.emit("permission_denied", { message: "Only Host or Moderator can control playback." });
      return reply(callback, { error: "Permission denied." });
    }
    result.room.playState = false;
    result.room.updatedAt = Date.now();
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  socket.on("seek", ({ time } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (!canControl(result.user)) {
      socket.emit("permission_denied", { message: "Only Host or Moderator can control playback." });
      return reply(callback, { error: "Permission denied." });
    }
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time > 86400) {
      return reply(callback, { error: "Invalid seek time." });
    }
    result.room.currentTime = time;
    result.room.updatedAt = Date.now();
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  socket.on("change_video", ({ video } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (!canControl(result.user)) {
      socket.emit("permission_denied", { message: "Only Host or Moderator can change the video." });
      return reply(callback, { error: "Permission denied." });
    }
    const videoId = extractVideoId(video);
    if (!videoId) return reply(callback, { error: "Enter a valid YouTube URL or 11-character video ID." });

    result.room.videoId = videoId;
    result.room.playState = false;
    result.room.currentTime = 0;
    result.room.updatedAt = Date.now();
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  socket.on("assign_role", ({ userId, role } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (result.user.role !== "Host") return reply(callback, { error: "Only the Host can assign roles." });
    if (!["Moderator", "Participant"].includes(role)) {
      return reply(callback, { error: "Role must be Moderator or Participant." });
    }
    if (userId === socket.id) return reply(callback, { error: "You cannot change your own role here." });

    const target = result.room.participants.get(userId);
    if (!target) return reply(callback, { error: "Participant not found." });
    target.role = role;
    broadcastRoom(result.roomId);
    io.to(userId).emit("role_changed", { role });
    reply(callback, { success: true });
  });

  socket.on("remove_participant", ({ userId } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (result.user.role !== "Host") return reply(callback, { error: "Only the Host can remove participants." });
    if (userId === socket.id) return reply(callback, { error: "You cannot remove yourself." });
    if (!result.room.participants.has(userId)) return reply(callback, { error: "Participant not found." });

    const targetSocket = io.sockets.sockets.get(userId);
    result.room.participants.delete(userId);
    if (targetSocket) {
      targetSocket.leave(result.roomId);
      targetSocket.data.roomId = null;
      targetSocket.emit("removed_from_room", { message: "The host removed you from the room." });
    }
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  // Participants can request a playback/video change. It does not happen until
  // a Host or Moderator explicitly approves it.
  socket.on("request_action", ({ action, payload } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (canControl(result.user)) return reply(callback, { error: "You can perform this action directly." });
    if (!["play", "pause", "seek", "change_video"].includes(action)) {
      return reply(callback, { error: "Unsupported action." });
    }

    const requestId = crypto.randomUUID();
    if (!result.room.requests) result.room.requests = new Map();
    result.room.requests.set(requestId, {
      requestId,
      userId: socket.id,
      username: result.user.username,
      action,
      payload: payload || {},
      createdAt: Date.now()
    });
    io.to(result.roomId).emit("action_requested", {
      requestId,
      username: result.user.username,
      action,
      payload: payload || {}
    });
    reply(callback, { success: true, requestId });
  });

  socket.on("resolve_action_request", ({ requestId, approve } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (!canControl(result.user)) return reply(callback, { error: "Only Host or Moderator can review requests." });

    const request = result.room.requests?.get(requestId);
    if (!request) return reply(callback, { error: "Request not found." });
    result.room.requests.delete(requestId);

    if (!approve) {
      io.to(request.userId).emit("action_request_resolved", { requestId, approved: false });
      return reply(callback, { success: true });
    }

    if (request.action === "change_video") {
      const id = extractVideoId(request.payload.video);
      if (!id) return reply(callback, { error: "The requested YouTube URL is invalid." });
      result.room.videoId = id;
      result.room.currentTime = 0;
      result.room.playState = false;
    } else if (request.action === "seek") {
      const time = request.payload.time;
      if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time > 86400) {
        return reply(callback, { error: "Invalid requested seek time." });
      }
      result.room.currentTime = time;
    } else {
      result.room.playState = request.action === "play";
    }
    result.room.updatedAt = Date.now();
    io.to(request.userId).emit("action_request_resolved", { requestId, approved: true });
    broadcastRoom(result.roomId);
    reply(callback, { success: true });
  });

  socket.on("chat_message", ({ message } = {}, callback) => {
    const result = getJoinedRoom(socket);
    if (result.error) return reply(callback, result);
    if (typeof message !== "string" || !message.trim()) return reply(callback, { error: "Message cannot be empty." });
    const item = {
      id: crypto.randomUUID(),
      username: result.user.username,
      message: message.trim().slice(0, 500),
      createdAt: Date.now()
    };
    io.to(result.roomId).emit("chat_message", item);
    reply(callback, { success: true });
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    leaveCurrentRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Watch Party server running at http://localhost:${PORT}`);
});
