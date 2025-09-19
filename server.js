require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const chatRoutes = require("./routes/chat.routes");
const User = require("./models/user.model");
const Chat = require("./models/chat.model");
const Message = require("./models/message.model"); // Import the Message model
const { authSocket } = require("./middleware/auth.middleware");

const app = express();
const server = http.createServer(app);

// CORS Configuration for Netlify + DigitalOcean
const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  methods: ["GET", "POST"],
};

const io = new Server(server, { cors: corsOptions });

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chats", chatRoutes);

// Database Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully."))
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

  // Handle sending a new message
  socket.on("sendMessage", async ({ chatId, content }) => {
    try {
      const message = new Message({
        chatId,
        senderId: socket.userId,
        content, // This is the encrypted content from the client
      });
      const savedMessage = await message.save();
      await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });

      // Populate sender info before emitting
      const populatedMessage = await Message.findById(
        savedMessage._id
      ).populate("senderId", "username _id");

      // Emit to all clients in the chat room
      io.to(chatId).emit("newMessage", populatedMessage);
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
          io.to(recipientSocketId).emit("friendOffline", socket.userId);
        }
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
