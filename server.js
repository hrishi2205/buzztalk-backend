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
const Message = require("./models/message.model");
const { auth, authSocket } = require("./middleware/auth.middleware");

const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);

const requiredEnv = ["MONGO_URI", "JWT_SECRET"]; // minimal required
const missing = requiredEnv.filter(
  (k) => !process.env[k] || process.env[k].length === 0
);
if (missing.length) {
  console.error("Missing required env vars:", missing.join(", "));
}

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
  origin(origin, cb) {
    if (
      !origin ||
      staticAllowedOrigins.includes(origin) ||
      isDevLocalhost(origin)
    )
      return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
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
    origin(origin, cb) {
      if (
        !origin ||
        staticAllowedOrigins.includes(origin) ||
        isDevLocalhost(origin)
      )
        return cb(null, true);
      return cb(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    methods: corsOptions.methods,
    allowedHeaders: corsOptions.allowedHeaders,
    credentials: corsOptions.credentials,
  },
});

app.set("io", io);
app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return cors(corsOptions)(req, res, next);
  next();
});
app.use(express.json());

// Static uploads dir
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `avatar_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only image files are allowed."));
  },
});
const uploadAny = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chats", chatRoutes);

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
      update.avatarUrl = url;
      await User.findByIdAndUpdate(req.user.id, update);
      res.status(200).json({ url });
    } catch (e) {
      console.error("Avatar upload error:", e);
      res.status(500).json({ message: "Server error uploading avatar." });
    }
  }
);

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
      res
        .status(200)
        .json({
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

app.get(["/", "/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected successfully.");
    try {
      await Chat.syncIndexes();
      console.log("Chat indexes synced.");
    } catch (e) {
      console.warn("Warning syncing Chat indexes:", e?.message || e);
    }
  })
  .catch((err) => console.error("MongoDB connection error:", err));

const onlineUsers = new Map();
io.use(authSocket);
io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.id} userId: ${socket.userId}`);
  onlineUsers.set(socket.userId, socket.id);
  await User.findByIdAndUpdate(socket.userId, { status: "online" });
  const user = await User.findById(socket.userId).populate("friends");
  if (user)
    user.friends.forEach((friend) => {
      const sid = onlineUsers.get(friend._id.toString());
      if (sid) io.to(sid).emit("friendOnline", socket.userId);
    });
  const userChats = await Chat.find({ participants: socket.userId });
  userChats.forEach((c) => socket.join(c._id.toString()));

  socket.on("joinChat", async ({ chatId }) => {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      if (chat.participants.some((p) => p.toString() === socket.userId))
        socket.join(chatId.toString());
    } catch (e) {
      console.error("joinChat error:", e.message);
    }
  });

  socket.on("sendMessage", async ({ chatId, content }) => {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      if (!chat.participants.some((p) => p.toString() === socket.userId))
        return;
      const participants = chat.participants.map((p) => p.toString());
      const otherId = participants.find((p) => p !== socket.userId);
      const [meUser, otherUser] = await Promise.all([
        User.findById(socket.userId).select("blocked"),
        User.findById(otherId).select("blocked"),
      ]);
      if (
        (meUser?.blocked || []).some((b) => b.toString() === otherId) ||
        (otherUser?.blocked || []).some((b) => b.toString() === socket.userId)
      )
        return;
      const message = new Message({ chatId, senderId: socket.userId, content });
      const savedMessage = await message.save();
      await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });
      const populatedMessage = await Message.findById(
        savedMessage._id
      ).populate("senderId", "username _id displayName avatarUrl");
      socket.join(chatId.toString());
      io.to(chatId.toString()).emit("newMessage", populatedMessage);
      const room = io.sockets.adapter.rooms.get(chatId.toString());
      for (const participant of chat.participants) {
        const uid = participant.toString();
        if (uid === socket.userId) continue;
        const sid = onlineUsers.get(uid);
        if (sid && (!room || !room.has(sid)))
          io.to(sid).emit("newMessage", populatedMessage);
      }
    } catch (error) {
      console.error("Error saving message:", error);
    }
  });

  socket.on("startTyping", ({ chatId }) => {
    socket.to(chatId).emit("userTyping", { chatId, userId: socket.userId });
  });
  socket.on("stopTyping", ({ chatId }) => {
    socket
      .to(chatId)
      .emit("userStoppedTyping", { chatId, userId: socket.userId });
  });

  socket.on("reactMessage", async ({ messageId, emoji }) => {
    try {
      if (!messageId || !emoji) return;
      const message = await Message.findById(messageId);
      if (!message) return;
      const chat = await Chat.findById(message.chatId);
      if (!chat) return;
      if (!chat.participants.some((p) => p.toString() === socket.userId))
        return;
      const idx = (message.reactions || []).findIndex(
        (r) => r.userId?.toString() === socket.userId && r.emoji === emoji
      );
      if (idx >= 0) message.reactions.splice(idx, 1);
      else
        message.reactions.push({
          userId: socket.userId,
          emoji,
          at: new Date(),
        });
      await message.save();
      io.to(chat._id.toString()).emit("messageReaction", {
        messageId,
        reactions: message.reactions,
      });
    } catch (e) {
      console.error("reactMessage error:", e.message);
    }
  });

  socket.on("sendFriendRequest", ({ recipientId }) => {
    const sid = onlineUsers.get(recipientId);
    if (sid) io.to(sid).emit("newFriendRequest");
  });
  socket.on("acceptFriendRequest", ({ requesterId }) => {
    const sid = onlineUsers.get(requesterId);
    if (sid) io.to(sid).emit("friendRequestAccepted");
  });

  socket.on("disconnect", async () => {
    console.log(`User disconnected: ${socket.id}`);
    onlineUsers.delete(socket.userId);
    await User.findByIdAndUpdate(socket.userId, {
      status: "offline",
      lastSeen: new Date(),
    });
    const disconnected = await User.findById(socket.userId).populate("friends");
    if (disconnected)
      disconnected.friends.forEach((friend) => {
        const sid = onlineUsers.get(friend._id.toString());
        if (sid)
          io.to(sid).emit("friendOffline", {
            userId: socket.userId,
            lastSeen: disconnected.lastSeen,
          });
      });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
