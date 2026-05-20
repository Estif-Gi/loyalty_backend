const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require('http');
const { Server } = require('socket.io');
require("dotenv").config();
const { setIo } = require('./sockets/ioInstance');
// after creating io:

const app = express();

app.use(cors({
    origin: "http://localhost:8081",   // ← no trailing slash
    credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:8081",  // ← no trailing slash
        methods: ["GET", "POST"],
        credentials: true
    }
});

setIo(io);

// Socket.IO setup
const socketAuth = require('./middleware/socketAuth');
const { registerUserSockets } = require('./sockets/userSocket');

io.use(socketAuth);
io.on('connection', (socket) => {
  registerUserSockets(socket);
});

// Logger
app.use((req, res, next) => {
  console.log("API called ->", req.method, req.originalUrl);
  next();
});

app.get("/", (req, res) => {
  res.send({ message: "Let's get loyalty started" });
});

app.use("/api/users", require("./routes/users"));
app.use("/api/restaurants", require("./routes/restaurants"));
app.use("/api/menus", require("./routes/menus"));
app.use("/api/loyalty", require("./routes/loyalty_programs"));
app.use("/api/notifications", require("./routes/notifications"));

app.use((err, req, res, next) => {
  console.error("🔥 Global Error Handler Caught:", err);
  res.status(500).json({ message: err.message || "An unexpected error occurred" });
});

const PORT = process.env.PORT || 5001;

mongoose
  .connect(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/?appName=loyaltyApp`
  )
  .then(() => {
    console.log("**** Connected to MongoDB ****");
    server.listen(PORT, () => {          // ← server.listen, NOT app.listen
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.log("❌ Failed to connect to MongoDB:", err);
  });

module.exports = app;