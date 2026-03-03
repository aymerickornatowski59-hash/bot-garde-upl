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

// =======================
// 🔥 Connexion MongoDB
// =======================
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connexion MongoDB réussie");
    app.listen(PORT, () => {
      console.log("🚀 Bot démarré sur le port " + PORT);
    });
  })
  .catch(err => {
    console.error("❌ Erreur MongoDB :", err.message);
  });

// =======================
// 📦 Schemas
// =======================
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

// =======================
// 🔐 Vérification Webhook
// =======================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// =======================
// 📩 Webhook réception
// =======================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const event = entry.messaging[0];

      if (event.message) {
        await handleMessage(event.sender.id, event.message.text);
      }

      if (event.postback) {
        await handleMessage(event.sender.id, event.postback.payload);
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// =======================
// 🧠 LOGIQUE BOT
// =======================
async function handleMessage(senderId, text) {
  if (!text) return;
  text = text.toLowerCase();

  let user = await User.findOne({ messengerId: senderId });

  // ENREGISTRER NOM
  if (text.startsWith("nom ")) {
    const nom = text.substring(4).trim();

    if (!user) {
      user = new User({ messengerId: senderId, nom });
    } else {
      user.nom = nom;
    }

    await user.save();
    await sendMessage(senderId, `✅ Ton nom est enregistré : ${nom}`);
    return;
  }

  // ARRIVEE
  if (text === "arrivee") {
    if (!user) {
      await sendMessage(senderId, "⚠️ Enregistre ton nom avec : nom TonPrenom");
      return;
    }

    const dejaEnGarde = await Garde.findOne({
      messengerId: senderId,
      depart: null
    });

    if (dejaEnGarde) {
      await sendMessage(senderId, "⚠️ Tu es déjà en garde.");
      return;
    }

    await Garde.create({
      messengerId: senderId,
      nom: user.nom,
      arrivee: new Date()
    });

    await sendMessage(senderId, `🟢 ${user.nom} est en garde.`);
    return;
  }

  // DEPART
  if (text === "depart") {
    if (!user) {
      await sendMessage(senderId, "⚠️ Enregistre ton nom d'abord.");
      return;
    }

    const garde = await Garde.findOne({
      messengerId: senderId,
      depart: null
    }).sort({ arrivee: -1 });

    if (!garde) {
      await sendMessage(senderId, "❌ Aucune garde active.");
      return;
    }

    garde.depart = new Date();
    await garde.save();

    await sendMessage(senderId, `🔴 ${user.nom} a terminé sa garde.`);
    return;
  }

  // EN GARDE
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

  // MENU PAR DEFAUT
  await sendButtons(senderId);
}

// =======================
// 📤 ENVOI MESSAGE
// =======================
async function sendMessage(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text }
    }
  );
}

// =======================
// 🔘 BOUTONS
// =======================
async function sendButtons(senderId) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Choisis une action :",
            buttons: [
              { type: "postback", title: "🟢 Arrivée", payload: "arrivee" },
              { type: "postback", title: "🔴 Départ", payload: "depart" },
              { type: "postback", title: "👀 En garde", payload: "en garde" }
            ]
          }
        }
      }
    }
  );
}
// =======================
// 📅 Résumé quotidien
// =======================

cron.schedule("59 23 * * *", async () => {
  console.log("📊 Envoi du résumé quotidien...");

  const today = new Date().toISOString().split("T")[0];
  const gardes = await Garde.find({ date: today });

  const users = await User.find();

  let message;

  if (gardes.length === 0) {
    message = "📅 Résumé du jour :\nAucune garde enregistrée.";
  } else {
    const liste = gardes.map(g => {
      const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");
      const depart = g.depart
        ? new Date(g.depart).toLocaleTimeString("fr-FR")
        : "En cours";

      return `• ${g.nom} : ${arrivee} → ${depart}`;
    }).join("\n");

    message = `📅 Résumé du jour :\n${liste}`;
  }

  for (const user of users) {
    await sendMessage(user.messengerId, message);
  }

  console.log("✅ Résumé envoyé");
});
