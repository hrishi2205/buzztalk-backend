require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const chatRoutes = require("./routes/chat.routes");
const User = require("./models/user.model");
const Chat = require("./models/chat.model");
const Message = require("./models/message.model"); // Import the Message model
const { auth, authSocket } = require("./middleware/auth.middleware");

const app = express();
const server = http.createServer(app);

// Behind reverse proxies (Netlify, Nginx), trust X-Forwarded-* headers
app.set("trust proxy", 1);

// Basic env validation early to fail fast in deploys
const requiredEnv = ["MONGO_URI", "JWT_SECRET"];
const missing = requiredEnv.filter(
  (k) => !process.env[k] || process.env[k].length === 0
);
if (missing.length) {
  console.error("Missing required environment variables:", missing.join(", "));
}

// CORS Configuration for local and production
const staticAllowedOrigins = [
  process.env.CLIENT_URL,
  process.env.CLIENT_URL_2,
  process.env.CLIENT_URL_3,
  process.env.CLIENT_URL_4,
  "https://buzztalk.me",
  "https://www.buzztalk.me",
  "https://tangerine-daffodil-1d942b.netlify.app",
  "http://localhost:5173",
  "http://localhost:5000",
].filter(Boolean);

const isDevLocalhost = (origin) =>
  typeof origin === "string" &&
  (origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1"));

const corsOptions = {
  origin: function (origin, callback) {
    // Allow REST tools or same-origin requests with no Origin header
    if (
      !origin ||
      staticAllowedOrigins.includes(origin) ||
      isDevLocalhost(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
  ],
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (
        !origin ||
        staticAllowedOrigins.includes(origin) ||
        isDevLocalhost(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    methods: corsOptions.methods,
    allowedHeaders: corsOptions.allowedHeaders,
    credentials: corsOptions.credentials,
  },
});

// Middleware
// Make io available to routes
app.set("io", io);
app.use(cors(corsOptions));
// Ensure all preflight requests succeed quickly (Express 5: avoid "*" route)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return cors(corsOptions)(req, res, next);
  }
  next();
});
app.use(express.json());
// Serve static uploads
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

// Multer storage for avatar uploads (store in MongoDB, so use memory storage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const name = `avatar_${Date.now()}_${Math.round(
      Math.random() * 1e9
    )}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    return cb(new Error("Only image files are allowed."));
  },
});

// Memory storage for avatars to store directly in MongoDB
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    return cb(new Error("Only image files are allowed."));
  },
});

// Multer for generic chat file uploads (up to 10 MB, broader types)
const uploadAny = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chats", chatRoutes);

// Avatar upload endpoint (authenticated)
app.post(
  "/api/upload/avatar",
  auth,
  uploadMem.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "No file uploaded." });
      const update = {
        avatar: req.file.buffer,
        avatarContentType: req.file.mimetype,
        avatarUpdatedAt: new Date(),
      };
      const url = `${req.protocol}://${req.get("host")}/api/users/${
        req.user.id
      }/avatar?ts=${Date.now()}`;
      update.avatarUrl = url; // keep avatarUrl to ease client consumption
      await User.findByIdAndUpdate(req.user.id, update);
      res.status(200).json({ url });
    } catch (e) {
      console.error("Avatar upload error:", e);
      res.status(500).json({ message: "Server error uploading avatar." });
    }
  }
);

// Chat file upload endpoint (authenticated) - returns { url, filename, mimetype, size }
app.post(
  "/api/upload/file",
  auth,
  uploadAny.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "No file uploaded." });
      const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.file.filename
      }`;
      res.status(200).json({
        url: fileUrl,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });
    } catch (e) {
      console.error("File upload error:", e);
      res.status(500).json({ message: "Server error uploading file." });
    }
  }
);

// Health check endpoint
app.get(["/", "/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Database Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected successfully.");
    try {
      // Ensure indexes (including unique pairKey) are in place
      await Chat.syncIndexes();
      console.log("Chat indexes are synced.");
    } catch (e) {
      console.warn("Warning syncing Chat indexes:", e?.message || e);
    }
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Real-Time Logic (Socket.IO)
const onlineUsers = new Map(); // Maps userId -> socket.id

io.use(authSocket); // JWT authentication for sockets

io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.id} with userId: ${socket.userId}`);
  onlineUsers.set(socket.userId, socket.id);

  await User.findByIdAndUpdate(socket.userId, { status: "online" });

  // Notify friends that this user is online
  const user = await User.findById(socket.userId).populate("friends");
  if (user) {
    user.friends.forEach((friend) => {
      const recipientSocketId = onlineUsers.get(friend._id.toString());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("friendOnline", socket.userId);
      }
    });
  }

  // Join rooms for all of the user's existing chats
  const userChats = await Chat.find({ participants: socket.userId });
  userChats.forEach((chat) => socket.join(chat._id.toString()));

  // --- CORE REAL-TIME LOGIC ---

  // Allow client to explicitly join a chat room after opening it
  socket.on("joinChat", async ({ chatId }) => {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      // Only allow if the user is a participant
      const isParticipant = chat.participants.some(
        (p) => p.toString() === socket.userId
      );
      if (isParticipant) {
        socket.join(chatId.toString());
      }
    } catch (e) {
      console.error("joinChat error:", e.message);
    }
  });

  // Handle sending a new message
  socket.on("sendMessage", async ({ chatId, content }) => {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      // Only participants can send
      if (!chat.participants.some((p) => p.toString() === socket.userId)) {
        return;
      }
      // Enforce block: neither side should have blocked the other
      const participants = chat.participants.map((p) => p.toString());
      const otherId = participants.find((p) => p !== socket.userId);
      const [meUser, otherUser] = await Promise.all([
        User.findById(socket.userId).select("blocked"),
        User.findById(otherId).select("blocked"),
      ]);
      if (
        (meUser?.blocked || []).some((b) => b.toString() === otherId) ||
        (otherUser?.blocked || []).some((b) => b.toString() === socket.userId)
      ) {
        return; // silently drop
      }

      const message = new Message({ chatId, senderId: socket.userId, content });
      const savedMessage = await message.save();
      await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });

      // Populate sender info before emitting
      const populatedMessage = await Message.findById(
        savedMessage._id
      ).populate("senderId", "username _id displayName avatarUrl");

      // Ensure sender is in the chat room before broadcasting
      socket.join(chatId.toString());

      // Emit to all clients in the chat room
      io.to(chatId.toString()).emit("newMessage", populatedMessage);

      // Additionally emit directly to other online participants who are NOT in the room
      const room = io.sockets.adapter.rooms.get(chatId.toString());
      for (const participant of chat.participants) {
        const uid = participant.toString();
        if (uid === socket.userId) continue; // skip sender
        const sid = onlineUsers.get(uid);
        if (sid && (!room || !room.has(sid))) {
          io.to(sid).emit("newMessage", populatedMessage);
        }
      }
    } catch (error) {
      console.error("Error saving message:", error);
    }
  });

  // Handle typing indicators
  socket.on("startTyping", ({ chatId }) => {
    socket.to(chatId).emit("userTyping", { chatId, userId: socket.userId });
  });

  socket.on("stopTyping", ({ chatId }) => {
    socket
      .to(chatId)
      .emit("userStoppedTyping", { chatId, userId: socket.userId });
  });

  // Handle message reactions (toggle per-user per-emoji)
  socket.on("reactMessage", async ({ messageId, emoji }) => {
    try {
      if (!messageId || !emoji) return;
      const message = await Message.findById(messageId);
      if (!message) return;
      const chat = await Chat.findById(message.chatId);
      if (!chat) return;
      const isParticipant = chat.participants.some(
        (p) => p.toString() === socket.userId
      );
      if (!isParticipant) return;

      const idx = (message.reactions || []).findIndex(
        (r) => r.userId?.toString() === socket.userId && r.emoji === emoji
      );
      if (idx >= 0) {
        message.reactions.splice(idx, 1);
      } else {
        message.reactions.push({
          userId: socket.userId,
          emoji,
          at: new Date(),
        });
      }
      await message.save();

      const payload = { messageId, reactions: message.reactions };
      io.to(chat._id.toString()).emit("messageReaction", payload);
    } catch (e) {
      console.error("reactMessage error:", e.message);
    }
  });

  // Handle friend request notifications
  socket.on("sendFriendRequest", ({ recipientId }) => {
    const recipientSocketId = onlineUsers.get(recipientId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("newFriendRequest");
    }
  });

  socket.on("acceptFriendRequest", ({ requesterId }) => {
    const requesterSocketId = onlineUsers.get(requesterId);
    if (requesterSocketId) {
      io.to(requesterSocketId).emit("friendRequestAccepted");
    }
  });

  // Handle user disconnection
  socket.on("disconnect", async () => {
    console.log(`User disconnected: ${socket.id}`);
    onlineUsers.delete(socket.userId);
    await User.findByIdAndUpdate(socket.userId, {
      status: "offline",
      lastSeen: new Date(),
    });

    // Notify friends that this user is offline
    const disconnectedUser = await User.findById(socket.userId).populate(
      "friends"
    );
    if (disconnectedUser) {
      disconnectedUser.friends.forEach((friend) => {
        const recipientSocketId = onlineUsers.get(friend._id.toString());
        if (recipientSocketId) {
          io.to(recipientSocketId).emit("friendOffline", {
            userId: socket.userId,
            lastSeen: disconnectedUser.lastSeen,
          });
        }
      });
    }
  });
});

// Default to 5000 to match frontend's default API URL
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
