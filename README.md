## Chat Backend (Restored)

Express + Socket.IO + MongoDB backend for real-time chat with:

- JWT auth (HTTP + Socket.IO handshake)
- User registration (email OTP flow) & login
- Friend requests, block / unblock, unfriend
- 1:1 chats with last message + unread counts
- Message reactions and typing indicators
- Avatar upload (buffer stored in MongoDB) + generic file uploads (disk)
- Encrypted private key bundle storage (for E2E client crypto)

### Tech Stack

Node.js, Express 5, Socket.IO 4, Mongoose 8, Multer, SendGrid (optional), bcryptjs, JSON Web Tokens.

### Environment Variables (.env)

See `.env.example` for full list.

Required:

```
MONGO_URI=...        # Mongo connection string
JWT_SECRET=...       # Secret for signing tokens
```

Optional CORS origins: `CLIENT_URL`, `CLIENT_URL_2`, etc.
Optional email: `SENDGRID_API_KEY`, `SENDER_EMAIL`.

### Install & Run

```
npm install
npm run dev   # nodemon
# or
npm start
```

Health check: `GET /api/health`

### Scripts

`npm run dedupe:chats` – remove duplicate 1:1 chat docs & backfill `pairKey`.

### Folder Structure

```
server.js
models/        # Mongoose schemas
routes/        # Express route modules
middleware/    # Auth middleware
utils/         # sendEmail wrapper
uploads/       # Served static, ignored in git
scripts/       # Maintenance scripts
```

### Security Notes

- Ensure `JWT_SECRET` is long & random.
- Do NOT commit `.env`.
- Consider adding rate limiting & helmet for production.

### License

ISC (adjust as needed)
