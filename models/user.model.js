const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      // Not required at initial registration; set during completion step
      required: false,
    },
    // Password will be set during completion step
    password: { type: String, required: false },
    // Store user's public key as a string (e.g., JWK or PEM)
    publicKey: { type: String },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    lastSeen: { type: Date },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Incoming friend requests as subdocuments { from: ObjectId<User>, createdAt }
    friendRequests: [
      new mongoose.Schema(
        {
          from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          createdAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    // Temporary token used between verify and complete steps
    verificationToken: { type: String },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
