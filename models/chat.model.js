const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    pairKey: { type: String, index: true, unique: true, sparse: true },
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

chatSchema.pre("save", function (next) {
  try {
    if (
      !this.pairKey &&
      Array.isArray(this.participants) &&
      this.participants.length === 2
    ) {
      this.pairKey = this.participants
        .map((id) => id.toString())
        .sort()
        .join(":");
    }
  } catch {}
  next();
});

module.exports = mongoose.model("Chat", chatSchema);
