const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
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

module.exports = mongoose.model("Chat", chatSchema);
