const router = require("express").Router();
const Chat = require("../models/chat.model");
const User = require("../models/user.model");
const Message = require("../models/message.model");
const { auth } = require("../middleware/auth.middleware");

router.use(auth);

router.post("/", async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) {
      return res.status(400).json({ message: "friendId is required" });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user.friends.some((id) => id.toString() === friendId.toString())) {
      return res
        .status(400)
        .json({ message: "You are not friends with this user" });
    }
    // Ensure deterministic unordered key
    const key = [userId.toString(), friendId.toString()].sort().join(":");
    // First try to find any existing 1:1 chat by participants (for legacy docs without pairKey)
    let chat = await Chat.findOne({
      participants: { $all: [userId, friendId], $size: 2 },
    }).sort({ createdAt: 1 });
    if (chat) {
      // Backfill pairKey if missing
      if (!chat.pairKey) {
        try {
          await Chat.updateOne({ _id: chat._id }, { $set: { pairKey: key } });
          chat.pairKey = key;
        } catch (e) {
          // If duplicate key error due to another doc already having this pairKey, prefer the existing one
          if (e && e.code === 11000) {
            const byKey = await Chat.findOne({ pairKey: key });
            if (byKey) chat = byKey;
          }
        }
      }
      return res.status(200).json(chat);
    }

    // Upsert a chat document atomically to avoid duplicates on races/double clicks
    try {
      chat = await Chat.findOneAndUpdate(
        { pairKey: key },
        {
          $setOnInsert: {
            participants: [userId, friendId],
            pairKey: key,
          },
        },
        { new: true, upsert: true }
      );
    } catch (e) {
      // In very rare race, fallback to fetch by key
      chat = await Chat.findOne({ pairKey: key });
    }
    return res.status(200).json(chat);
  } catch (err) {
    console.error("Error creating chat:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

//fetch all messages for a specific chat
router.get("/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    // Verify user is a participant of the chat
    const chat = await Chat.findById(chatId);
    if (
      !chat ||
      !chat.participants.some((id) => id.toString() === userId.toString())
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to view these messages." });
    }

    const messages = await Message.find({ chatId })
      .populate("senderId", "username displayName avatarUrl _id")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// List chats for the authenticated user (participants populated minimal fields)
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const chatsRaw = await Chat.find({ participants: userId })
      .populate("participants", "username displayName avatarUrl _id")
      .populate("lastMessage");

    // Deduplicate chats by pairKey or sorted participants (in case old docs exist)
    const seen = new Set();
    const chats = [];
    for (const chat of chatsRaw) {
      let k = chat.pairKey;
      if (
        !k &&
        Array.isArray(chat.participants) &&
        chat.participants.length === 2
      ) {
        const ids = chat.participants.map(
          (p) => p._id?.toString?.() || p.toString()
        );
        k = ids.sort().join(":");
      }
      if (!k) {
        // Fallback to doc id to avoid dropping
        k = `id:${chat._id}`;
      }
      if (seen.has(k)) continue;
      seen.add(k);
      chats.push(chat);
    }

    // Compute unread counts per chat (simple approach)
    const result = [];
    for (const chat of chats) {
      let lastRead = new Date(0);
      if (Array.isArray(chat.lastReads)) {
        const entry = chat.lastReads.find((r) => r.user?.toString() === userId);
        if (entry?.at) lastRead = new Date(entry.at);
      }
      // Count messages after lastRead
      const unread = await Message.countDocuments({
        chatId: chat._id,
        createdAt: { $gt: lastRead },
        // Do not count your own messages as unread for yourself
        senderId: { $ne: userId },
      });
      result.push({ ...chat.toObject(), unread });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error("Error listing chats:", err);
    res.status(500).json({ message: "Server error listing chats." });
  }
});

// Update last read timestamp for a chat (mark-as-read)
router.post("/:chatId/read", async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found." });
    if (!chat.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({ message: "Not a participant." });
    }

    const now = new Date();
    const idx = (chat.lastReads || []).findIndex(
      (r) => r.user.toString() === userId
    );
    if (idx >= 0) chat.lastReads[idx].at = now;
    else chat.lastReads.push({ user: userId, at: now });
    await chat.save();
    // Emit read receipt to other participants via socket.io
    try {
      const io = req.app.get("io");
      if (io) {
        const otherIds = chat.participants
          .map((p) => p.toString())
          .filter((id) => id !== userId);
        io.to(chatId.toString()).emit("messagesRead", {
          chatId,
          userId,
          at: now,
        });
      }
    } catch (e) {}
    res.status(200).json({ message: "Marked as read.", at: now });
  } catch (err) {
    console.error("Error marking read:", err);
    res.status(500).json({ message: "Server error marking read." });
  }
});

// Delete a chat and all its messages (participants only)
router.delete("/:chatId", async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found." });
    if (!chat.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({ message: "Not a participant." });
    }

    // Remove messages and chat document
    await Message.deleteMany({ chatId });
    await Chat.deleteOne({ _id: chatId });

    // Emit room-wide chatDeleted so clients can update UI
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(chatId.toString()).emit("chatDeleted", { chatId });
      }
    } catch (e) {}

    res.status(200).json({ message: "Chat deleted.", chatId });
  } catch (err) {
    console.error("Error deleting chat:", err);
    res.status(500).json({ message: "Server error deleting chat." });
  }
});
module.exports = router;
