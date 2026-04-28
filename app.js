const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// CORS Headers
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE"
    );
    next();
});

// Logger
app.use((req, res, next) => {
    console.log("API called ->", req.method, req.originalUrl);
    next();
});

// Test Route
app.get("/", (req, res) => {
    res.send({ message: "Let's get loyalty started" });
});

// Routes
app.use("/api/users", require("./routes/users"));
app.use("/api/restaurants", require("./routes/restaurants"));
app.use("/api/menus", require("./routes/menus"));
app.use("/api/loyalty", require("./routes/loyalty_programs"));
app.use("/api/notifications", require("./routes/notifications"));

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("🔥 Global Error Handler Caught:", err);
    res.status(500).json({
        message: err.message || "An unexpected error occurred",
    });
});

// MongoDB Connection
const PORT = process.env.PORT || 5001;

mongoose
    .connect(
        `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`,
        {
            bufferCommands: false,
            serverSelectionTimeoutMS: 10000,
        }
    )
    .then(() => {
        console.log("**** Connected to MongoDB ****");
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.log("❌ Failed to connect to MongoDB:", err);
    });

module.exports = app;