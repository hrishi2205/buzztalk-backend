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
    if (recipient.friends.some((id) => id.equals(senderId))) {
      return res.status(400).json({ message: "You are already friends." });
    }

    // Check if a request has already been sent
    if (recipient.friendRequests.some((req) => req.from.equals(senderId))) {
      return res.status(400).json({ message: "Request already sent." });
    }

    // Check if there is a pending request from the recipient
    if (sender.friendRequests.some((req) => req.from.equals(recipientId))) {
      return res.status(400).json({
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
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json(user.friendRequests || []);
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
/**
 * Rotate/Update the authenticated user's public key.
 * Accepts either a JWK object/string (must include 'kty') or a PEM string.
 */
router.post("/public-key", async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      return res.status(400).json({ message: "publicKey is required." });
    }

    let normalized = null;
    if (typeof publicKey === "object") {
      if (!publicKey.kty) {
        return res.status(400).json({ message: "Invalid public key: missing 'kty' in JWK." });
      }
      normalized = JSON.stringify(publicKey);
    } else if (typeof publicKey === "string") {
      const trimmed = publicKey.trim();
      if (trimmed.startsWith("{")) {
        try {
          const jwk = JSON.parse(trimmed);
          if (!jwk.kty) {
            return res.status(400).json({ message: "Invalid public key: missing 'kty' in JWK." });
          }
          normalized = JSON.stringify(jwk);
        } catch (e) {
          return res.status(400).json({ message: "Invalid public key: malformed JWK JSON." });
        }
      } else {
        // PEM or other format
        normalized = trimmed;
      }
    } else {
      return res.status(400).json({ message: "Invalid public key format." });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { publicKey: normalized },
      { new: true }
    ).select("_id username email publicKey");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(200).json({ message: "Public key updated.", user });
  } catch (error) {
    console.error("Error updating public key:", error);
    res.status(500).json({ message: "Server error updating public key." });
  }
});
