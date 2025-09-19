const router = require("express").Router();
const User = require("../models/user.model");
const { auth } = require("../middleware/auth.middleware");

// Middleware to protect all routes in this file
router.use(auth);

// Search for a user by username
router.get("/search/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({
      username: username.toLowerCase(),
    }).select("username _id");

    if (!user || user._id.equals(req.user.id)) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error during user search." });
  }
});

// Send a friend request
router.post("/friend-request/send", async (req, res) => {
  try {
    const { recipientId } = req.body;
    const senderId = req.user.id;

    const recipient = await User.findById(recipientId);
    const sender = await User.findById(senderId);

    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found." });
    }

    // Check if already friends
    if (recipient.friends.includes(senderId)) {
      return res.status(400).json({ message: "You are already friends." });
    }

    // Check if a request has already been sent
    if (recipient.friendRequests.some((req) => req.from.equals(senderId))) {
      return res.status(400).json({ message: "Request already sent." });
    }

    // Check if there is a pending request from the recipient
    if (sender.friendRequests.some((req) => req.from.equals(recipientId))) {
      return res
        .status(400)
        .json({
          message:
            "This user has already sent you a request. Check your friend requests.",
        });
    }

    recipient.friendRequests.push({ from: senderId });
    await recipient.save();

    res.status(200).json({ message: "Friend request sent." });
  } catch (error) {
    res.status(500).json({ message: "Server error sending friend request." });
  }
});

// Respond to a friend request (accept/reject)
router.post("/friend-request/respond", async (req, res) => {
  try {
    const { requesterId, response } = req.body; // response: 'accept' or 'reject'
    const recipientId = req.user.id;

    const recipient = await User.findById(recipientId);
    const requester = await User.findById(requesterId);

    if (!recipient || !requester) {
      return res.status(404).json({ message: "User not found." });
    }

    // Remove request from recipient's list
    recipient.friendRequests = recipient.friendRequests.filter(
      (req) => !req.from.equals(requesterId)
    );

    if (response === "accept") {
      // Add each other to friends lists
      recipient.friends.push(requesterId);
      requester.friends.push(recipientId);
      await requester.save();
    }

    await recipient.save();

    res.status(200).json({ message: `Friend request ${response}ed.` });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Server error responding to friend request." });
  }
});

// Get all current friend requests for the logged-in user
router.get("/friend-requests", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate(
      "friendRequests.from",
      "username _id"
    );
    res.status(200).json(user.friendRequests);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching friend requests." });
  }
});

// Get all friends for the logged-in user
router.get("/friends", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate(
      "friends",
      "username _id status publicKey"
    );
    res.status(200).json(user.friends);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching friends." });
  }
});

module.exports = router;
