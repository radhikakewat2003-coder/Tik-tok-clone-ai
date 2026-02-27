require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const OpenAI = require("openai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

mongoose.connect("mongodb://127.0.0.1:27017/tiktokAI");

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

/* ================= MODELS ================= */

const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  followers: [String],
  following: [String]
});

const VideoSchema = new mongoose.Schema({
  url: String,
  userId: String,
  likes: [String],
  caption: String,
  hashtags: String,
  createdAt: { type: Date, default: Date.now }
});

const CommentSchema = new mongoose.Schema({
  videoId: String,
  userId: String,
  text: String
});

const User = mongoose.model("User", UserSchema);
const Video = mongoose.model("Video", VideoSchema);
const Comment = mongoose.model("Comment", CommentSchema);

/* ================= AUTH ================= */

app.post("/signup", async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10);
  const user = await User.create({
    email: req.body.email,
    password: hash,
    followers: [],
    following: []
  });
  res.json(user);
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.json({ msg: "User not found" });

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.json({ msg: "Wrong password" });

  const token = jwt.sign({ id: user._id }, "SECRET");
  res.json({ token });
});

/* ================= FOLLOW ================= */

app.post("/follow/:id", async (req, res) => {
  const currentUser = req.body.userId;
  const targetUser = req.params.id;

  await User.findByIdAndUpdate(currentUser, {
    $addToSet: { following: targetUser }
  });

  await User.findByIdAndUpdate(targetUser, {
    $addToSet: { followers: currentUser }
  });

  res.json({ msg: "Followed" });
});

/* ================= VIDEO UPLOAD WITH AI ================= */

app.post("/upload", async (req, res) => {
  const { url, userId, description } = req.body;

  // AI Caption
  const captionRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Generate viral short caption" },
      { role: "user", content: description }
    ]
  });

  const hashtagRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Generate trending hashtags" },
      { role: "user", content: description }
    ]
  });

  const video = await Video.create({
    url,
    userId,
    likes: [],
    caption: captionRes.choices[0].message.content,
    hashtags: hashtagRes.choices[0].message.content
  });

  res.json(video);
});

/* ================= LIKE ================= */

app.post("/like/:videoId", async (req, res) => {
  const { userId } = req.body;
  const video = await Video.findById(req.params.videoId);

  if (video.likes.includes(userId)) {
    video.likes.pull(userId);
  } else {
    video.likes.push(userId);
  }

  await video.save();
  res.json(video);
});

/* ================= INFINITE SCROLL ================= */

app.get("/videos", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 5;

  const videos = await Video.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json(videos);
});

/* ================= AI COMMENT FILTER ================= */

app.post("/comment", async (req, res) => {
  const { videoId, userId, text } = req.body;

  const filter = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Reply SAFE or ABUSIVE" },
      { role: "user", content: text }
    ]
  });

  if (filter.choices[0].message.content !== "SAFE") {
    return res.json({ msg: "Abusive comment not allowed" });
  }

  const comment = await Comment.create({ videoId, userId, text });
  res.json(comment);
});

/* ================= REAL-TIME CHAT ================= */

io.on("connection", (socket) => {
  console.log("User Connected");

  socket.on("sendMessage", (data) => {
    io.emit("receiveMessage", data);
  });
});

/* ================= AI CHATBOT ================= */

app.post("/chatbot", async (req, res) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are TikTok assistant" },
      { role: "user", content: req.body.message }
    ]
  });

  res.json({ reply: response.choices[0].message.content });
});

/* ================= START ================= */

server.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});
