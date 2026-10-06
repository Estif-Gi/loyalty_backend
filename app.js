const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
require("dotenv").config({ path: path.join(__dirname, '.env'), override: true });
const { validateEncryptionConfig } = require('./utils/crypto');
validateEncryptionConfig();
const { setIo } = require('./sockets/ioInstance');

const app = express();
const allowedOrigins = [
  "https://loyalty-customer.vercel.app",
  "https://loyal.bahirandelivery.com",
  "https://loyal.employee.bahirandelivery.com",
  "https://loyal-employee.vercel.app",
  "http://localhost:8081",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:4173",
  "https://getloyal.bahirandelivery.com",
  "https://loyal.employee.bahirandelivery.com/"
];

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Allow any bahirandelivery.com subdomain or nested subdomain
  if (/^https?:\/\/([a-zA-Z0-9-]+\.)*bahirandelivery\.com(:\d+)?$/.test(origin)) return true;
  // Allow Vercel preview/production deployments
  if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;
  return false;
}

// 1. CORS — must be first
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) callback(null, true);
    else callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// 2. Body parser
app.use(express.json());
app.use('/icons', express.static(path.join(__dirname, 'icons')));

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
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false
  }
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
app.use("/api/restaurants", require("./routes/restaurantTables"));
app.use("/api/restaurants", require("./routes/restaurantQrCodes"));
app.use("/api/menus", require("./routes/menus"));
app.use("/api/loyalty", require("./routes/loyalty_programs"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/order-sessions", require("./routes/orderSessions"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/employee/orders", require("./routes/employeeOrders"));
app.use("/api/admin", require("./routes/admin"));

// 7. Global error handler — must be last
app.use((err, req, res, next) => {
  console.error("🔥 Global Error Handler Caught:", err);
  res.status(500).json({ message: err.message || "An unexpected error occurred" });
});

const PORT = process.env.PORT || 5001;

async function connectWithRetry(retries = 5, delayMs = 3000) {
  const encodedPassword = encodeURIComponent(process.env.DB_PASSWORD || '');
  const mongoUri = `mongodb+srv://${process.env.DB_USER}:${encodedPassword}@loyaltyapp.uno2z8g.mongodb.net/?appName=loyaltyApp`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔌 Connecting to MongoDB Atlas (attempt ${attempt}/${retries})...`);
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000
      });
      console.log("**** Connected to MongoDB ****");
      server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
      return;
    } catch (err) {
      console.error(`❌ Failed to connect to MongoDB (attempt ${attempt}/${retries}):`, err.message);
      if (err.errorLabelSet) {
        console.error("   Error labels:", Array.from(err.errorLabelSet).join(', '));
      }

      if (attempt === retries) {
        console.error("🔥 All connection attempts exhausted. Please check your network and MongoDB Atlas IP access list.");
        process.exit(1);
      }

      console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

if (require.main === module) {
  connectWithRetry();
}

app.server = server;
module.exports = app;
