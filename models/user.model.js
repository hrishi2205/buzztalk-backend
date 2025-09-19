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
    // Optional display name for nicer presentation
    displayName: { type: String, trim: true },
    // Password will be set during completion step
    password: { type: String, required: false },
    // Store user's public key as a string (e.g., JWK or PEM)
    publicKey: { type: String },
    // End-to-end encryption: store the user's private key encrypted at rest
    // Ciphertext and parameters are base64 strings (URL-safe not required here)
    epkCiphertext: { type: String },
    epkIv: { type: String },
    epkSalt: { type: String },
    epkIterations: { type: Number },
    epkAlgo: { type: String, default: "pbkdf2-aesgcm-v1" },
    // Optional avatar URL; client may upload elsewhere and store the public URL here
    avatarUrl: { type: String, trim: true },
    // Profile avatar stored directly in MongoDB for persistence
    avatar: { type: Buffer },
    avatarContentType: { type: String },
    avatarUpdatedAt: { type: Date },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    lastSeen: { type: Date },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Blocked users (current user has blocked these user IDs)
    blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
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
