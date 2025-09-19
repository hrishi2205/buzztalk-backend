const jwt = require("jsonwebtoken");

//! Middleware to authenticate requests using JWT

const auth = (req, res, next) => {
  try {
    // Check for token in Authorization header
    const authHeader = req.headers("Authorization");
    if (!authHeader) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied." });
    }
    // Bearer token format
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ message: "Malformed token, authorization denied." });
    }
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info to request object
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    console.error("Authentication error:", error.message);
    res.status(401).json({ message: "Token is not valid." });
  }
};

/**
 * Middleware for authenticating Socket.IO connections.
 * It verifies the JWT passed in the socket's handshake auth object.
 */
const authSocket = (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided."));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    console.error("Socket authentication error:", err.message);
    next(new Error("Authentication error: Invalid token."));
  }
};

module.exports = { auth, authSocket };
