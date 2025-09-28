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
      required: false,
    },
    displayName: { type: String, trim: true },
    password: { type: String, required: false },
    publicKey: { type: String },
    epkCiphertext: { type: String },
    epkIv: { type: String },
    epkSalt: { type: String },
    epkIterations: { type: Number },
    epkAlgo: { type: String, default: "pbkdf2-aesgcm-v1" },
    avatarUrl: { type: String, trim: true },
    avatar: { type: Buffer },
    avatarContentType: { type: String },
    avatarUpdatedAt: { type: Date },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    lastSeen: { type: Date },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
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
