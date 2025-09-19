const router = require("express").Router();
const User = require("../models/user.model");
const Chat = require("../models/chat.model");
const Message = require("../models/message.model");
const { auth } = require("../middleware/auth.middleware");
const bcrypt = require("bcryptjs");

// Public avatar endpoint by user ID; streams the stored MongoDB avatar
// Placed BEFORE auth middleware so browser <img> tags can load without JWT headers
router.get("/:userId/avatar", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "avatar avatarContentType avatarUpdatedAt"
    );
    if (!user || !user.avatar) {
      return res.status(404).send("No avatar");
    }
    res.set("Content-Type", user.avatarContentType || "image/png");
    res.set(
      "Cache-Control",
      "public, max-age=86400, stale-while-revalidate=600"
    );
    if (user.avatarUpdatedAt) {
      res.set("Last-Modified", user.avatarUpdatedAt.toUTCString());
    }
    return res.status(200).send(user.avatar);
  } catch (e) {
    return res.status(500).send("Error fetching avatar");
  }
});

// Middleware to protect all subsequent routes in this file
router.use(auth);

// Get current user's profile (minimal fields)
router.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "_id username email displayName avatarUrl status lastSeen publicKey epkCiphertext epkIv epkSalt epkIterations epkAlgo"
    );
    if (!user) return res.status(404).json({ message: "User not found." });
    const out = user.toObject();
    // Return EPK bundle metadata only to the owner
    res.status(200).json({
      _id: out._id,
      username: out.username,
      email: out.email,
      displayName: out.displayName,
      avatarUrl: out.avatarUrl,
      status: out.status,
      lastSeen: out.lastSeen,
      publicKey: out.publicKey,
      encryptedPrivateKey: out.epkCiphertext
        ? {
            ciphertext: out.epkCiphertext,
            iv: out.epkIv,
            salt: out.epkSalt,
            iterations: out.epkIterations,
            algo: out.epkAlgo,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error fetching profile." });
  }
});

// Search for a user by username
router.get("/search/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({
      username: username.toLowerCase(),
    }).select("username _id avatarUrl displayName");

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

    // Always remove this request entry if present (idempotent)
    await User.updateOne(
      { _id: recipientId },
      { $pull: { friendRequests: { from: requesterId } } }
    );

    if (response === "accept") {
      // Add each other as friends without duplicates
      await Promise.all([
        User.updateOne(
          { _id: recipientId },
          { $addToSet: { friends: requesterId } }
        ),
        User.updateOne(
          { _id: requesterId },
          { $addToSet: { friends: recipientId } }
        ),
      ]);
    }

    res.status(200).json({ message: `Friend request ${response}ed.` });
  } catch (error) {
    console.error("Error responding to friend request:", error);
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
      "username displayName avatarUrl _id status publicKey lastSeen"
    );
    res.status(200).json(user.friends);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching friends." });
  }
});

// Unfriend a user (removes from both users' friends arrays)
router.post("/unfriend", async (req, res) => {
  try {
    const { userId } = req.body;
    const me = req.user.id;
    if (!userId) return res.status(400).json({ message: "userId required" });
    // Remove each other as friends
    await Promise.all([
      User.updateOne({ _id: me }, { $pull: { friends: userId } }),
      User.updateOne({ _id: userId }, { $pull: { friends: me } }),
    ]);
    return res.status(200).json({ message: "Unfriended successfully." });
  } catch (e) {
    console.error("Unfriend error:", e);
    return res.status(500).json({ message: "Server error unfriending." });
  }
});

// Block a user: add to blocked list and ensure not friends
router.post("/block", async (req, res) => {
  try {
    const { userId } = req.body;
    const me = req.user.id;
    if (!userId) return res.status(400).json({ message: "userId required" });
    await Promise.all([
      User.updateOne(
        { _id: me },
        { $addToSet: { blocked: userId }, $pull: { friends: userId } }
      ),
      User.updateOne({ _id: userId }, { $pull: { friends: me } }),
    ]);
    return res.status(200).json({ message: "User blocked." });
  } catch (e) {
    console.error("Block error:", e);
    return res.status(500).json({ message: "Server error blocking user." });
  }
});

// Unblock a user
router.post("/unblock", async (req, res) => {
  try {
    const { userId } = req.body;
    const me = req.user.id;
    if (!userId) return res.status(400).json({ message: "userId required" });
    await User.updateOne({ _id: me }, { $pull: { blocked: userId } });
    return res.status(200).json({ message: "User unblocked." });
  } catch (e) {
    console.error("Unblock error:", e);
    return res.status(500).json({ message: "Server error unblocking user." });
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
        return res
          .status(400)
          .json({ message: "Invalid public key: missing 'kty' in JWK." });
      }
      normalized = JSON.stringify(publicKey);
    } else if (typeof publicKey === "string") {
      const trimmed = publicKey.trim();
      if (trimmed.startsWith("{")) {
        try {
          const jwk = JSON.parse(trimmed);
          if (!jwk.kty) {
            return res
              .status(400)
              .json({ message: "Invalid public key: missing 'kty' in JWK." });
          }
          normalized = JSON.stringify(jwk);
        } catch (e) {
          return res
            .status(400)
            .json({ message: "Invalid public key: malformed JWK JSON." });
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

/**
 * Update profile fields: displayName, avatarUrl
 */
router.patch("/profile", async (req, res) => {
  try {
    const { displayName, avatarUrl } = req.body;
    const update = {};
    if (typeof displayName === "string") update.displayName = displayName;
    if (typeof avatarUrl === "string") update.avatarUrl = avatarUrl;

    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
    }).select("_id username email displayName avatarUrl");

    if (!user) return res.status(404).json({ message: "User not found." });
    res.status(200).json(user);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error updating profile." });
  }
});

// Public avatar endpoint by user ID; streams the stored MongoDB avatar
// (moved above auth)

/**
 * Set or update the encrypted private key bundle for the authenticated user.
 * Body: { ciphertext, iv, salt, iterations?, algo? }
 */
router.post("/private-key", async (req, res) => {
  try {
    const { ciphertext, iv, salt, iterations, algo } = req.body || {};
    if (!ciphertext || !iv || !salt) {
      return res
        .status(400)
        .json({ message: "ciphertext, iv and salt are required." });
    }
    const update = {
      epkCiphertext: String(ciphertext),
      epkIv: String(iv),
      epkSalt: String(salt),
    };
    if (iterations) update.epkIterations = Number(iterations);
    if (algo) update.epkAlgo = String(algo);
    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
    }).select(
      "_id username email epkCiphertext epkIv epkSalt epkIterations epkAlgo"
    );
    if (!user) return res.status(404).json({ message: "User not found." });
    return res.status(200).json({
      message: "Encrypted private key updated.",
      encryptedPrivateKey: {
        ciphertext: user.epkCiphertext,
        iv: user.epkIv,
        salt: user.epkSalt,
        iterations: user.epkIterations,
        algo: user.epkAlgo,
      },
    });
  } catch (error) {
    console.error("Error updating encrypted private key:", error);
    res
      .status(500)
      .json({ message: "Server error updating encrypted private key." });
  }
});

// Delete account permanently (verify password first)
router.post("/delete-account", async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password)
      return res.status(400).json({ message: "Password required." });
    const me = await User.findById(req.user.id).select("password");
    if (!me) return res.status(404).json({ message: "User not found." });
    const ok = await bcrypt.compare(password, me.password || "");
    if (!ok) return res.status(401).json({ message: "Invalid password." });

    // Remove from others' friends and friendRequests, blocked
    await Promise.all([
      User.updateMany(
        { friends: req.user.id },
        { $pull: { friends: req.user.id } }
      ),
      User.updateMany(
        { "friendRequests.from": req.user.id },
        { $pull: { friendRequests: { from: req.user.id } } }
      ),
      User.updateMany(
        { blocked: req.user.id },
        { $pull: { blocked: req.user.id } }
      ),
    ]);
    // Delete chats where user is a participant and related messages
    const chats = await Chat.find({ participants: req.user.id }).select("_id");
    const chatIds = chats.map((c) => c._id);
    if (chatIds.length) {
      await Promise.all([
        Message.deleteMany({ chatId: { $in: chatIds } }),
        Chat.deleteMany({ _id: { $in: chatIds } }),
      ]);
    }
    // Finally delete the user
    await User.deleteOne({ _id: req.user.id });
    return res.status(200).json({ message: "Account deleted." });
  } catch (e) {
    console.error("Delete account error:", e);
    return res.status(500).json({ message: "Server error deleting account." });
  }
});
