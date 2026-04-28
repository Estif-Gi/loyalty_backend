const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDb = require("./config/db");
const app = express();


app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
    next();
});

app.use((req, res, next) => {
    console.log("message: API called ->", req.method, req.originalUrl);
    next();
});
app.get("/" , (req , res) => {
    res.send({message:"lets get loyalty started"});
});

app.use("/api", async (req, res, next) => {
    try {
        await connectDb();
        next();
    } catch (error) {
        console.error("DB connection error:", error);
        res.status(500).json({ message: "Database connection failed" });
    }
});

app.use("/api/users" , require("./routes/users"));
app.use("/api/restaurants" , require("./routes/restaurants"));
app.use("/api/menus" , require("./routes/menus"));
app.use("/api/loyalty" , require("./routes/loyalty_programs"));
app.use("/api/notifications" , require("./routes/notifications"));

// Global error handler
app.use((err, req, res, next) => {
    console.error("🔥 Global Error Handler Caught:", err);
    res.status(500).json({ message: "An unexpected error occurred" });
});

if (process.env.NODE_ENV !== "production") {
    connectDb()
        .then(() => {
            console.log("****Connected to MongoDB****");
            app.listen(process.env.PORT || 5001);
        })
        .catch(err => {
            console.log("//////Failed to connect to MongoDB:///////", err);
        });
}

module.exports = app;