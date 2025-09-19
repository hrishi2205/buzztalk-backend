require("dotenv").config();
const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
const Message = require("../models/message.model");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const chats = await Chat.find({});
    const groups = new Map();

    for (const chat of chats) {
      let key = chat.pairKey;
      if (
        !key &&
        Array.isArray(chat.participants) &&
        chat.participants.length === 2
      ) {
        key = chat.participants
          .map((p) => p.toString())
          .sort()
          .join(":");
      }
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chat);
    }

    let totalMerged = 0;

    for (const [key, list] of groups.entries()) {
      if (list.length <= 1) continue;
      // Choose canonical: earliest createdAt
      const sorted = list.sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      const canonical = sorted[0];
      const dupes = sorted.slice(1);
      console.log(
        `Merging ${dupes.length} duplicates into ${canonical._id} for pair ${key}`
      );

      for (const dupe of dupes) {
        // Reassign messages
        await Message.updateMany(
          { chatId: dupe._id },
          { $set: { chatId: canonical._id } }
        );
        // Merge lastReads entries
        const reads = Array.isArray(dupe.lastReads) ? dupe.lastReads : [];
        for (const r of reads) {
          const idx = (canonical.lastReads || []).findIndex(
            (x) => x.user.toString() === r.user.toString()
          );
          if (idx >= 0) {
            const newer =
              new Date(r.at) > new Date(canonical.lastReads[idx].at);
            if (newer) canonical.lastReads[idx].at = r.at;
          } else {
            canonical.lastReads = canonical.lastReads || [];
            canonical.lastReads.push({ user: r.user, at: r.at });
          }
        }
        await Chat.deleteOne({ _id: dupe._id });
        totalMerged++;
      }
      // Ensure pairKey set
      if (!canonical.pairKey) canonical.pairKey = key;
      // Update lastMessage to latest message
      const lastMsg = await Message.findOne({ chatId: canonical._id }).sort({
        createdAt: -1,
      });
      canonical.lastMessage = lastMsg ? lastMsg._id : undefined;
      await canonical.save();
    }

    console.log(
      `Deduplication complete. Merged ${totalMerged} duplicate chats.`
    );
    process.exit(0);
  } catch (e) {
    console.error("Error during dedupe:", e);
    process.exit(1);
  }
})();
