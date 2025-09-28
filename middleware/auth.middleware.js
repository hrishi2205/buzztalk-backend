const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"] || req.get("authorization");
    if (!authHeader)
      return res
        .status(401)
        .json({ message: "No token, authorization denied." });
    const parts = authHeader.split(" ");
    const token =
      parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : null;
    if (!token)
      return res
        .status(401)
        .json({ message: "Malformed token, authorization denied." });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    console.error("Authentication error:", err.message);
    res.status(401).json({ message: "Token is not valid." });
  }
};

const authSocket = (socket, next) => {
  try {
    let token = socket.handshake.auth?.token;
    if (!token) {
      const authHeader = socket.handshake.headers?.authorization;
      if (authHeader && /^Bearer\s+/i.test(authHeader))
        token = authHeader.replace(/^Bearer\s+/i, "").trim();
    }
    if (!token)
      return next(new Error("Authentication error: No token provided."));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    console.error("Socket authentication error:", err.message);
    next(new Error("Authentication error: Invalid token."));
  }
};

module.exports = { auth, authSocket };
