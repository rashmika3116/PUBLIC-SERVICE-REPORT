
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.ADMIN_PASSWORD ||
  !process.env.SESSION_SECRET
) {
  throw new Error("Missing required environment variables in .env");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: "pir.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 2 * 60 * 60 * 1000
    }
  })
);

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

const validCategories = [
  "Road Damage",
  "Streetlight",
  "Water Supply",
  "Garbage",
  "Campus Maintenance",
  "Other"
];

const validStatuses = [
  "Pending",
  "In Progress",
  "Resolved",
  "Rejected"
];

function makeCode(prefix) {
  return prefix + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function hashCode(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) {
    return res.status(401).json({ error: "Administrator login required." });
  }
  next();
}

function publicIssue(issue) {
  return {
    reportId: issue.report_code,
    title: issue.title,
    category: issue.category,
    location: issue.location,
    description: issue.description,
    status: issue.status,
    teamName: issue.team_name || "",
    resolutionNote: issue.resolution_note || "",
    createdAt: issue.created_at,
    updatedAt: issue.updated_at
  };
}

async function getStats() {
  const { data, error } = await supabase
    .from("issues")
    .select("status");

  if (error) throw error;

  const stats = {
    total: data.length,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0
  };

  for (const issue of data) {
    if (issue.status === "Pending") stats.pending++;
    if (issue.status === "In Progress") stats.inProgress++;
    if (issue.status === "Resolved") stats.resolved++;
    if (issue.status === "Rejected") stats.rejected++;
  }

  return stats;
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "Public Issue Reporting System" });
});

// Submit a new issue
app.post("/api/issues", reportLimiter, async (req, res) => {
  try {
    const title = cleanText(req.body.title, 120);
    const category = cleanText(req.body.category, 60);
    const location = cleanText(req.body.location, 200);
    const description = cleanText(req.body.description, 2000);
    const email = cleanText(req.body.email, 254);

    if (!title || !category || !location || !description) {
      return res.status(400).json({
        error: "Please provide title, category, location, and description."
      });
    }

    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: "Invalid issue category." });
    }

    if (
      email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({ error: "Please enter a valid email." });
    }

    const reportId = makeCode("PIR");
    const trackingCode = crypto.randomBytes(6).toString("hex").toUpperCase();

    const { error } = await supabase.from("issues").insert({
      report_code: reportId,
      tracking_code_hash: hashCode(trackingCode),
      title,
      category,
      location,
      description,
      email: email || null,
      status: "Pending"
    });

    if (error) throw error;

    // The tracking code is shown only at submission time.
    res.status(201).json({ reportId, trackingCode });
  } catch (error) {
    console.error("Issue submission failed:", error.message);
    res.status(500).json({ error: "Unable to submit the report right now." });
  }
});

// Track an issue using its report ID and tracking code
app.post("/api/issues/:reportId/track", reportLimiter, async (req, res) => {
  try {
    const reportId = cleanText(req.params.reportId, 40).toUpperCase();
    const trackingCode = cleanText(req.body.trackingCode, 40).toUpperCase();

    if (!reportId || !trackingCode) {
      return res.status(400).json({
        error: "Report ID and tracking code are required."
      });
    }

    const { data: issue, error } = await supabase
      .from("issues")
      .select(
        "report_code, tracking_code_hash, title, category, location, description, status, team_name, resolution_note, created_at, updated_at"
      )
      .eq("report_code", reportId)
      .maybeSingle();

    if (error) throw error;

    if (
      !issue ||
      hashCode(trackingCode) !== issue.tracking_code_hash
    ) {
      return res.status(404).json({
        error: "Report not found. Check your report ID and tracking code."
      });
    }

    res.json({ issue: publicIssue(issue) });
  } catch (error) {
    console.error("Tracking failed:", error.message);
    res.status(500).json({ error: "Unable to track the report right now." });
  }
});

// Administrator login
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  try {
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const valid = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD
    );

    if (!valid) {
      return res.status(401).json({ error: "Incorrect administrator password." });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: "Unable to start admin session." });
      }

      req.session.isAdmin = true;
      res.json({ message: "Login successful." });
    });
  } catch (error) {
    console.error("Admin login failed:", error.message);
    res.status(500).json({ error: "Unable to log in right now." });
  }
});

// Administrator logout
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Unable to log out." });
    }

    res.clearCookie("pir.sid");
    res.json({ message: "Logged out successfully." });
  });
});

// List reports for the administrator dashboard
app.get("/api/admin/issues", requireAdmin, async (req, res) => {
  try {
    const { data: issues, error } = await supabase
      .from("issues")
      .select(
        "id, report_code, title, category, location, description, email, status, team_name, resolution_note, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const stats = await getStats();

    res.json({
      issues: issues.map((issue) => ({
        id: issue.id,
        ...publicIssue(issue),
        email: issue.email || ""
      })),
      stats
    });
  } catch (error) {
    console.error("Admin issue listing failed:", error.message);
    res.status(500).json({ error: "Unable to load reports." });
  }
});

// Update report status, assigned team, and resolution note
app.patch("/api/admin/issues/:id", requireAdmin, async (req, res) => {
  try {
    const id = cleanText(req.params.id, 50);
    const status = cleanText(req.body.status, 30);
    const teamName = cleanText(req.body.teamName, 120);
    const resolutionNote = cleanText(req.body.resolutionNote, 1000);

    if (!id || !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Please select a valid status." });
    }

    const { data: issue, error } = await supabase
      .from("issues")
      .update({
        status,
        team_name: teamName || null,
        resolution_note: resolutionNote || null,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select(
        "report_code, title, category, location, description, status, team_name, resolution_note, created_at, updated_at"
      )
      .maybeSingle();

    if (error) throw error;

    if (!issue) {
      return res.status(404).json({ error: "Report not found." });
    }

    res.json({ issue: publicIssue(issue) });
  } catch (error) {
    console.error("Issue update failed:", error.message);
    res.status(500).json({ error: "Unable to update the report." });
  }
});

// Serve the frontend from ../frontend
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Handle invalid API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.listen(PORT, () => {
  console.log(`Public Issue Reporting System running at http://localhost:${PORT}`);
});
