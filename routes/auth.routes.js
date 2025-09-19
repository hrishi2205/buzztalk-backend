const router = require("express").Router();
const User = require("../models/user.model");
const sendEmail = require("../utils/sendEmail"); // Email utility (SendGrid)
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config();

//! Initiate Registration - Send Verification Email
router.post("/register/initiate", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }
    let user = await User.findOne({ email: email.toLowerCase() });

    if (user && user.isVerified) {
      return res.status(400).json({ message: "Email is already registered." });
    }
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes from now
    const hashedOtp = await bcrypt.hash(otp, 10);

    if (user) {
      user.otp = hashedOtp;
      user.otpExpires = otpExpires;
    } else {
      user = new User({
        email: email.toLowerCase(),
        otp: hashedOtp,
        otpExpires,
      });
    }
    await user.save();
    //! send OTP
    const hasSendgrid =
      !!process.env.SENDGRID_API_KEY && !!process.env.SENDER_EMAIL;
    if (hasSendgrid) {
      await sendEmail({
        to: user.email,
        subject: "Your BuzzTalk verification code",
        templateId: "d-a0623de3bbe04af899d9fb8475a072b4",
        dynamicTemplateData: { otp },
      });
    } else {
      console.warn("SENDGRID not configured. OTP for", user.email, "is:", otp);
    }
    res.status(200).json({ message: "Verification code sent to email." });
  } catch (error) {
    console.error("Error in /register/initiate:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

//! VERIFY OTP
router.post("/register/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(400).json({ message: "Invalid email or OTP." });
    }
    if (new Date() > user.otpExpires) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }
    const isOtpValid = await bcrypt.compare(otp, user.otp);
    if (!isOtpValid) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;

    //create a temporary JWT token
    const verificationToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    user.verificationToken = verificationToken; // Store it for the next step
    await user.save();

    res
      .status(200)
      .json({ message: "Email verified successfully.", verificationToken });
  } catch (error) {
    console.error("Error in /register/verify:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

//! Complete profile
router.post("/register/complete", async (req, res) => {
  try {
    const {
      verificationToken,
      username,
      password,
      publicKey,
      displayName,
      avatarUrl,
      // Encrypted Private Key package (optional at registration)
      encryptedPrivateKey,
    } = req.body;

    if (!verificationToken || !username || !password || !publicKey) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    // Validate that the provided token matches the one on the user
    if (!user || user.verificationToken !== verificationToken) {
      return res.status(400).json({ message: "Invalid or expired session." });
    }
    if (!user.isVerified) {
      return res.status(401).json({
        message: "Email not verified. Please verify your email first.",
      });
    }

    // Check if username is already taken
    const existingUsername = await User.findOne({
      username: username.toLowerCase(),
    });
    if (existingUsername) {
      return res.status(400).json({ message: "Username is already taken." });
    }
    // Normalize and validate publicKey (accept JWK object or PEM string)
    let normalizedPublicKey = null;
    if (publicKey && typeof publicKey === "object") {
      // JWK object
      if (!publicKey.kty) {
        return res
          .status(400)
          .json({ message: "Invalid public key: missing 'kty' in JWK." });
      }
      try {
        normalizedPublicKey = JSON.stringify(publicKey);
      } catch (e) {
        return res
          .status(400)
          .json({ message: "Invalid public key: could not serialize JWK." });
      }
    } else if (typeof publicKey === "string") {
      const trimmed = publicKey.trim();
      if (trimmed.startsWith("{")) {
        // Looks like a JWK JSON string
        try {
          const jwk = JSON.parse(trimmed);
          if (!jwk.kty) {
            return res
              .status(400)
              .json({ message: "Invalid public key: missing 'kty' in JWK." });
          }
          normalizedPublicKey = JSON.stringify(jwk);
        } catch (e) {
          return res
            .status(400)
            .json({ message: "Invalid public key: malformed JWK JSON." });
        }
      } else {
        // Treat as PEM or raw key material string; basic sanity check
        if (
          !/BEGIN PUBLIC KEY|BEGIN RSA PUBLIC KEY|BEGIN EC PUBLIC KEY/.test(
            trimmed
          )
        ) {
          // Allow but warn; client-side crypto may fail if this isn't a real PEM
          console.warn(
            "Registration received non-PEM publicKey string; storing as-is."
          );
        }
        normalizedPublicKey = trimmed;
      }
    } else {
      return res.status(400).json({ message: "Invalid public key format." });
    }

    user.username = username.toLowerCase();
    user.password = password; // Will be hashed by pre-save hook
    user.publicKey = normalizedPublicKey;
    // If client provided encrypted private key bundle, store it
    if (
      encryptedPrivateKey &&
      typeof encryptedPrivateKey === "object" &&
      encryptedPrivateKey.ciphertext &&
      encryptedPrivateKey.iv &&
      encryptedPrivateKey.salt
    ) {
      user.epkCiphertext = String(encryptedPrivateKey.ciphertext);
      user.epkIv = String(encryptedPrivateKey.iv);
      user.epkSalt = String(encryptedPrivateKey.salt);
      if (encryptedPrivateKey.iterations)
        user.epkIterations = Number(encryptedPrivateKey.iterations);
      if (encryptedPrivateKey.algo)
        user.epkAlgo = String(encryptedPrivateKey.algo);
    }
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      user.displayName = displayName.trim();
    } else {
      user.displayName = user.displayName || user.username;
    }
    if (typeof avatarUrl === "string") {
      user.avatarUrl = avatarUrl.trim();
    }
    user.verificationToken = undefined;

    await user.save();

    //! Auto-login after registration
    const authToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Registration complete.",
      token: authToken,
      _id: user._id,
      username: user.username,
      email: user.email,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || null,
      // Provide EPK bundle metadata if stored
      encryptedPrivateKey: user.epkCiphertext
        ? {
            ciphertext: user.epkCiphertext,
            iv: user.epkIv,
            salt: user.epkSalt,
            iterations: user.epkIterations,
            algo: user.epkAlgo,
          }
        : null,
    });
  } catch (error) {
    console.error("Error in /register/complete:", error);
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(400).json({ message: "Invalid or expired session." });
    }
    res
      .status(500)
      .json({ message: "Server error during profile completion." });
  }
});

//! Login Route
router.post("/login", async (req, res) => {
  try {
    const { loginIdentifier, password } = req.body;
    const identifier = loginIdentifier.toLowerCase();

    //Find user by email or username
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    });

    if (!user || !user.isVerified) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.status(200).json({
      token,
      _id: user._id,
      username: user.username,
      email: user.email,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || null,
      // Return encrypted private key bundle if present so client can decrypt
      encryptedPrivateKey: user.epkCiphertext
        ? {
            ciphertext: user.epkCiphertext,
            iv: user.epkIv,
            salt: user.epkSalt,
            iterations: user.epkIterations,
            algo: user.epkAlgo,
          }
        : null,
    });
  } catch (error) {
    console.error("Error in /login:", error);
    res.status(500).json({ message: "Server error during login." });
  }
});

module.exports = router;
