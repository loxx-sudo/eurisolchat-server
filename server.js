const express   = require("express");
const webpush   = require("web-push");
const admin     = require("firebase-admin");

const app = express();
app.use(express.json());

// ── Firebase Admin — paste your service account JSON inline ──────
// (you'll download this from Firebase Console — instructions below)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://eurisolchat-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.database();

// ── VAPID keys — generated once, stored as env vars ──────────────
webpush.setVapidDetails(
  "mailto:" + process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Watch for new messages and push ──────────────────────────────
let lastProcessedKey = null;
let initialized      = false;

db.ref("eurisol_private_chat/messages").on("child_added", async (snap) => {
  // Skip all existing messages on first load
  if (!initialized) return;

  const message  = snap.val();
  const key      = snap.key;
  const senderId = message.username;

  if (!senderId) return;

  console.log(`New message from ${senderId}: ${message.message || "📷 photo"}`);

  // Get all saved web push subscriptions
  const subSnap = await db.ref("eurisol_private_chat/push_subscriptions").once("value");
  const subs    = subSnap.val();

  if (!subs) {
    console.log("No subscriptions saved yet");
    return;
  }

  const messageText = message.message
    ? message.message.substring(0, 100)
    : "📷 Sent a photo";

  const displayName = senderId.charAt(0).toUpperCase() + senderId.slice(1);

  const payload = JSON.stringify({
    title: displayName,
    body:  messageText,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    tag:   "eurisol-message",
    url:   "/"
  });

  // Send to everyone except the sender
  const recipients = Object.entries(subs).filter(([user]) => user !== senderId);

  for (const [user, subscription] of recipients) {
    try {
      await webpush.sendNotification(subscription, payload);
      console.log(`✅ Push sent to ${user}`);
    } catch (err) {
      console.error(`❌ Push failed for ${user}:`, err.statusCode, err.message);
      // Remove expired/invalid subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log(`Removing stale subscription for ${user}`);
        await db.ref(`eurisol_private_chat/push_subscriptions/${user}`).remove();
      }
    }
  }
});

// Mark as initialized after first load settles
db.ref("eurisol_private_chat/messages")
  .limitToLast(1)
  .once("value", () => {
    initialized = true;
    console.log("🚀 Push server ready — watching for new messages");
  });

// ── Health check endpoint (keeps Render free tier alive) ─────────
app.get("/", (req, res) => res.send("EurisolChat push server running ✅"));
app.get("/ping", (req, res) => res.json({ status: "ok", time: new Date() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
