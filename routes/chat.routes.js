const router = require("express").Router();
const Chat = require("../models/chat.model");
const User = require("../models/user.model");
const Message = require("../models/message.model");
const { auth } = require("../middleware/auth.middleware");

router.use(auth);

router.post("/", async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId)
      return res.status(400).json({ message: "friendId is required" });
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user.friends.some((id) => id.toString() === friendId.toString()))
      return res
        .status(400)
        .json({ message: "You are not friends with this user" });
    const key = [userId.toString(), friendId.toString()].sort().join(":");
    let chat = await Chat.findOne({
      participants: { $all: [userId, friendId], $size: 2 },
    }).sort({ createdAt: 1 });
    if (chat) {
      if (!chat.pairKey) {
        try {
          await Chat.updateOne({ _id: chat._id }, { $set: { pairKey: key } });
          chat.pairKey = key;
        } catch (e) {
          if (e && e.code === 11000) {
            const byKey = await Chat.findOne({ pairKey: key });
            if (byKey) chat = byKey;
          }
        }
      }
      return res.status(200).json(chat);
    }
    try {
      chat = await Chat.findOneAndUpdate(
        { pairKey: key },
        { $setOnInsert: { participants: [userId, friendId], pairKey: key } },
        { new: true, upsert: true }
      );
    } catch {
      chat = await Chat.findOne({ pairKey: key });
    }
    return res.status(200).json(chat);
  } catch (err) {
    console.error("Error creating chat:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

router.get("/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const chat = await Chat.findById(chatId);
    if (
      !chat ||
      !chat.participants.some((id) => id.toString() === userId.toString())
    )
      return res
        .status(403)
        .json({ message: "Unauthorized to view these messages." });
    const messages = await Message.find({ chatId })
      .populate("senderId", "username displayName avatarUrl _id")
      .sort({ createdAt: 1 });
    res.status(200).json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const chatsRaw = await Chat.find({ participants: userId })
      .populate("participants", "username displayName avatarUrl _id")
      .populate("lastMessage");
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
      if (!k) k = `id:${chat._id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      chats.push(chat);
    }
    const result = [];
    for (const chat of chats) {
      let lastRead = new Date(0);
      if (Array.isArray(chat.lastReads)) {
        const entry = chat.lastReads.find((r) => r.user?.toString() === userId);
        if (entry?.at) lastRead = new Date(entry.at);
      }
      const unread = await Message.countDocuments({
        chatId: chat._id,
        createdAt: { $gt: lastRead },
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

router.post("/:chatId/read", async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found." });
    if (!chat.participants.some((p) => p.toString() === userId))
      return res.status(403).json({ message: "Not a participant." });
    const now = new Date();
    const idx = (chat.lastReads || []).findIndex(
      (r) => r.user.toString() === userId
    );
    if (idx >= 0) chat.lastReads[idx].at = now;
    else chat.lastReads.push({ user: userId, at: now });
    await chat.save();
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(chatId.toString()).emit("messagesRead", {
          chatId,
          userId,
          at: now,
        });
      }
    } catch {}
    res.status(200).json({ message: "Marked as read.", at: now });
  } catch (err) {
    console.error("Error marking read:", err);
    res.status(500).json({ message: "Server error marking read." });
  }
});

router.delete("/:chatId", async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found." });
    if (!chat.participants.some((p) => p.toString() === userId))
      return res.status(403).json({ message: "Not a participant." });
    await Message.deleteMany({ chatId });
    await Chat.deleteOne({ _id: chatId });
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(chatId.toString()).emit("chatDeleted", { chatId });
      }
    } catch {}
    res.status(200).json({ message: "Chat deleted.", chatId });
  } catch (err) {
    console.error("Error deleting chat:", err);
    res.status(500).json({ message: "Server error deleting chat." });
  }
});

module.exports = router;
