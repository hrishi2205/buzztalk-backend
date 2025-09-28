#!/usr/bin/env node
// Script to dedupe 1:1 chats that may have been created prior to enforcing unique pairKey.
const mongoose = require("mongoose");
const Chat = require("../models/chat.model");
require("dotenv").config();

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("MONGO_URI required");
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected");
    const chats = await Chat.find({}).lean();
    const map = new Map();
    const toRemove = [];
    for (const c of chats) {
      if (!Array.isArray(c.participants) || c.participants.length !== 2)
        continue;
      const key = c.participants
        .map((id) => id.toString())
        .sort()
        .join(":");
      if (!map.has(key)) map.set(key, c);
      else toRemove.push(c._id);
    }
    if (toRemove.length) {
      console.log("Removing duplicates:", toRemove.length);
      await Chat.deleteMany({ _id: { $in: toRemove } });
    } else {
      console.log("No duplicates found.");
    }
    // Backfill missing pairKeys
    const needsKey = await Chat.find({
      $or: [{ pairKey: { $exists: false } }, { pairKey: null }],
    });
    for (const chat of needsKey) {
      if (Array.isArray(chat.participants) && chat.participants.length === 2) {
        chat.pairKey = chat.participants
          .map((id) => id.toString())
          .sort()
          .join(":");
        await chat.save();
        console.log("Backfilled pairKey for", chat._id.toString());
      }
    }
    console.log("Done.");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
