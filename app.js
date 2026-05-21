const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require('http');
const { Server } = require('socket.io');
require("dotenv").config();
const { setIo } = require('./sockets/ioInstance');

const app = express();

const allowedOrigins = [
  "https://loyalty-customer.vercel.app",
  "https://loyal-employee.vercel.app",
  "http://localhost:8081",
  "http://localhost:8080",
  "http://localhost:5173"
];

// 1. CORS — must be first
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// 2. Body parser
app.use(express.json());

// 3. Logger
app.use((req, res, next) => {
  console.log("API called ->", req.method, req.originalUrl);
  next();
});

// 4. Create http server from app — BEFORE creating io
const server = http.createServer(app);

// 5. Socket.IO — now server exists
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setIo(io);

const socketAuth = require('./middleware/socketAuth');
const { registerUserSockets } = require('./sockets/userSocket');

io.use(socketAuth);
io.on('connection', (socket) => {
  registerUserSockets(socket);
});

// 6. Routes
app.get("/", (req, res) => res.send({ message: "Let's get loyalty started" }));
app.use("/api/users", require("./routes/users"));
app.use("/api/restaurants", require("./routes/restaurants"));
app.use("/api/menus", require("./routes/menus"));
app.use("/api/loyalty", require("./routes/loyalty_programs"));
app.use("/api/notifications", require("./routes/notifications"));

// 7. Global error handler — must be last
app.use((err, req, res, next) => {
  console.error("🔥 Global Error Handler Caught:", err);
  res.status(500).json({ message: err.message || "An unexpected error occurred" });
});

const PORT = process.env.PORT || 5001;

mongoose
  .connect(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/?appName=loyaltyApp`)
  .then(() => {
    console.log("**** Connected to MongoDB ****");
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => console.log("❌ Failed to connect to MongoDB:", err));

module.exports = app;