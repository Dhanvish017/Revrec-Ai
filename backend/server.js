require("dotenv").config();

const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");

const paymentsRouter = require("./routes/payments");
const retryRouter = require("./routes/retry");
const dashboardRouter = require("./routes/dashboard");
const razorpayRouter = require("./routes/razorpay");
const webhooksRouter = require("./routes/webhooks");
const recoveryRouter = require("./routes/recovery");

const app = express();

app.use(cors());
// `verify` stashes the exact raw bytes on req.rawBody before parsing —
// the Razorpay webhook signature must be computed over those raw bytes,
// not over a re-serialized version of req.body. Every other route just
// keeps using req.body as before.
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    })
);


app.get("/", (req, res) => {
    res.json({
        message: "RevRec AI backend is running"
    });
});

app.use("/api/payments", paymentsRouter);
app.use("/api/retry", retryRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/razorpay", razorpayRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/recovery", recoveryRouter);


app.get("/api/test-db", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("payments")
            .select("*")
            .limit(1);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            message: "Supabase connected successfully",
            data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Database connection failed",
            error: error.message
        });
    }
});


// 404 fallback for unmatched routes.
app.use((req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
});

// Catch-all error handler (e.g. malformed JSON bodies from express.json()).
app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});