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

    const user = await User.findById(userId);
    if (!user.friends.includes(friendId)) {
      return res
        .status(400)
        .json({ message: "You are not friends with this user" });
    }
    let chat = await Chat.findOne({
      isGroupChat: false,
      participants: { $all: [userId, friendId], $size: 2 },
    });
    if (chat) {
      return res.status(200).json(chat);
    }
    //!create new chat
    const newChat = new Chat({
      participants: [userId, friendId],
    });

    const savedChat = await newChat.save();
    res.status(201).json(savedChat);
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
    if (!chat || !chat.participants.includes(userId)) {
      return res
        .status(403)
        .json({ message: "Unauthorized to view these messages." });
    }

    const messages = await Message.find({ chatId })
      .populate("senderId", "username _id")
      .sort({ timestamp: 1 });

    res.status(200).json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});
module.exports = router;
