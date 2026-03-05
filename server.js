const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

/* =========================
   🔥 Connexion MongoDB
========================= */
mongoose.connect(MONGODB_URI)
.then(() => {

  console.log("✅ MongoDB connecté");

  app.listen(PORT, async () => {

    console.log("🚀 Bot lancé sur port " + PORT);

    try {
      await setGetStarted();
      await resetMessengerMenu();
      await setPersistentMenu();
    } catch (err) {
      console.log("Menu déjà configuré");
    }

  });

})
.catch(err => {
  console.log("❌ MongoDB erreur", err);
});

/* =========================
   📦 Schemas
========================= */

const userSchema = new mongoose.Schema({
  messengerId: String,
  nom: String
});

const gardeSchema = new mongoose.Schema({
  messengerId: String,
  nom: String,
  arrivee: Date,
  depart: Date,
  date: {
    type: String,
    default: () => new Date().toISOString().split("T")[0]
  }
});

const User = mongoose.model("User", userSchema);
const Garde = mongoose.model("Garde", gardeSchema);

/* =========================
   🔐 Webhook verification
========================= */

app.get("/webhook", (req, res) => {

  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }

  res.sendStatus(403);

});

/* =========================
   📩 Réception messages
========================= */

app.post("/webhook", async (req, res) => {

  const body = req.body;

  if (body.object === "page") {

    for (const entry of body.entry) {

      for (const event of entry.messaging) {

        if (event.message) {

          const messageText = event.message.text;
          const payload = event.message.quick_reply?.payload;

          await handleMessage(event.sender.id, payload || messageText);

        }

        if (event.postback) {

          await handleMessage(event.sender.id, event.postback.payload);

        }

      }

    }

    return res.status(200).send("EVENT_RECEIVED");

  }

  res.sendStatus(404);

});

/* =========================
   📤 Envoi message
========================= */

async function sendMessage(senderId, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text }
    }
  );

}

/* =========================
   📤 Envoi boutons
========================= */

async function sendMenu(senderId) {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text: "Choisis une action 👇",
        quick_replies: [
          { content_type: "text", title: "🟢 Arrivée", payload: "arrivee" },
          { content_type: "text", title: "🔴 Départ", payload: "depart" },
          { content_type: "text", title: "👀 En garde", payload: "en garde" },
          { content_type: "text", title: "📅 Résumé", payload: "resume" },
          { content_type: "text", title: "📚 Historique", payload: "historique" },
          { content_type: "text", title: "🏆 Classement", payload: "classement" }
        ]
      }
    }
  );

}

/* =========================
   📤 Message à toute l'équipe
========================= */

async function sendToAll(text) {

  const users = await User.find();

  for (const user of users) {

    try {
      await sendMessage(user.messengerId, text);
    } catch (err) {
      console.log("Erreur envoi à", user.messengerId);
    }

  }

}

/* =========================
   🧠 Logique BOT
========================= */

async function handleMessage(senderId, text) {

  if (!text) return;

  text = text.toLowerCase();

  let user = await User.findOne({ messengerId: senderId });

  if (text === "get_started") {

    await sendMessage(senderId, "👋 Bienvenue ! Enregistre ton nom avec : nom TonPrenom");
    return;

  }

  if (text.startsWith("nom ")) {

    const nom = text.substring(4).trim();

    if (!user) {

      user = new User({
        messengerId: senderId,
        nom
      });

    } else {

      user.nom = nom;

    }

    await user.save();

    await sendMessage(senderId, "✅ Nom enregistré");
    await sendMenu(senderId);

    return;

  }

  /* =========================
     ARRIVEE
  ========================= */

  if (text === "arrivee") {

    if (!user) {

      await sendMessage(senderId, "⚠️ Enregistre ton nom avec : nom TonPrenom");
      return;

    }

    const deja = await Garde.findOne({
      messengerId: senderId,
      depart: null
    });

    if (deja) {

      await sendMessage(senderId, "⚠️ Tu es déjà en garde.");
      return;

    }

    await Garde.create({
      messengerId: senderId,
      nom: user.nom,
      arrivee: new Date()
    });

    const gardes = await Garde.find({ depart: null });

    const liste = gardes.map(g => `• ${g.nom}`).join("\n");

    await sendToAll(
      `🟢 ${user.nom} vient de prendre la garde\n\n👀 En garde :\n${liste}`
    );

     await sendMenu(senderId);

    return;

  }

  /* =========================
     DEPART
  ========================= */

  if (text === "depart") {

    const garde = await Garde.findOne({
      messengerId: senderId,
      depart: null
    });

    if (!garde) {

      await sendMessage(senderId, "❌ Aucune garde active.");
      return;

    }

    garde.depart = new Date();
    await garde.save();

    await sendToAll(`🔴 ${user.nom} a quitté la garde`);

    await sendMenu(senderId);

    return;

  }

  /* =========================
     QUI EST EN GARDE
  ========================= */

  if (text === "en garde") {

    const gardes = await Garde.find({ depart: null });

    if (gardes.length === 0) {

      await sendMessage(senderId, "👀 Personne en garde.");
      return;

    }

    const liste = gardes.map(g => `• ${g.nom}`).join("\n");

    await sendMessage(senderId, `🟢 En garde :\n${liste}`);

    return;

  }

  await sendMenu(senderId);

}

/* =========================
   📌 Get Started
========================= */

async function setGetStarted() {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      get_started: {
        payload: "GET_STARTED"
      }
    }
  );

}

/* =========================
   📌 Reset menu
========================= */

async function resetMessengerMenu() {

  await axios.delete(
    `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      data: {
        fields: ["persistent_menu"]
      }
    }
  );

}

/* =========================
   📌 Menu Messenger
========================= */

async function setPersistentMenu() {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      persistent_menu: [
        {
          locale: "default",
          composer_input_disabled: false,
          call_to_actions: [
            { type: "postback", title: "🟢 Arrivée", payload: "arrivee" },
            { type: "postback", title: "🔴 Départ", payload: "depart" },
            { type: "postback", title: "👀 En garde", payload: "en garde" }
          ]
        }
      ]
    }
  );

}

/* =========================
   📅 Résumé automatique
========================= */

cron.schedule("0 20 * * *", async () => {

  const today = new Date().toISOString().split("T")[0];

  const gardes = await Garde.find({ date: today });

  if (gardes.length === 0) return;

  const users = await User.find();

  const liste = gardes.map(g => {

    const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");

    const depart = g.depart
      ? new Date(g.depart).toLocaleTimeString("fr-FR")
      : "En cours";

    return `• ${g.nom} : ${arrivee} → ${depart}`;

  }).join("\n");

  const message = `📅 Résumé du jour\n\n${liste}`;

  for (const user of users) {

    await sendMessage(user.messengerId, message);

  }

});
