const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    // Unique key for a 1:1 chat based on sorted participant IDs
    // Ensures exactly one chat per unordered user pair
    pairKey: { type: String, index: true, unique: true, sparse: true },
    // Track last read timestamp per user for unread calculations
    lastReads: [
      new Schema(
        {
          user: { type: Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

// Backfill pairKey before save if participants present but pairKey missing
chatSchema.pre("save", function (next) {
  try {
    if (
      !this.pairKey &&
      Array.isArray(this.participants) &&
      this.participants.length === 2
    ) {
      const key = this.participants
        .map((id) => id.toString())
        .sort()
        .join(":");
      this.pairKey = key;
    }
  } catch {}
  next();
});

module.exports = mongoose.model("Chat", chatSchema);
