// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());

// configure transporter via env vars (e.g., SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "missing email" });

  const otp = genOTP();
  const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)); // 10 min

  await db.collection("otps").doc(email).set({ otp, expiresAt });

  // send mail
  const mail = {
    from: process.env.SMTP_FROM || "noreply@example.com",
    to: email,
    subject: "Your OTP",
    text: `Your verification code is ${otp}. It expires in 10 minutes.`
  };

  await transporter.sendMail(mail);
  res.json({ ok: true });
});

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: "missing" });

  const doc = await db.collection("otps").doc(email).get();
  if (!doc.exists) return res.status(400).json({ error: "no otp found" });

  const data = doc.data();
  const now = admin.firestore.Timestamp.now();
  if (data.otp !== otp) return res.status(400).json({ error: "invalid otp" });
  if (data.expiresAt.toMillis() < now.toMillis()) return res.status(400).json({ error: "expired" });

  await db.collection("otps").doc(email).delete(); // single-use
  res.json({ ok: true });
});

exports.api = functions.https.onRequest(app);
