const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");

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
// 📦 Schema
// =======================
const gardeSchema = new mongoose.Schema({
  nom: String,
  arrivee: Date,
  depart: Date,
  date: {
    type: String,
    default: () => new Date().toISOString().split("T")[0]
  }
});

const Garde = mongoose.model("Garde", gardeSchema);

// =======================
// 🔐 Vérification Webhook
// =======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook vérifié");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// =======================
// 📩 Réception messages
// =======================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const event = entry.messaging[0];

      if (event.message) {
        const senderId = event.sender.id;
        const messageText = event.message.text;

        await handleMessage(senderId, messageText);
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// =======================
// 🧠 Logique BOT
// =======================
async function handleMessage(senderId, messageText) {
  if (!messageText) return;

  const text = messageText.toLowerCase();

  // ENREGISTRER NOM
  if (text.startsWith("nom ")) {
    const nom = messageText.substring(4).trim();

    await Garde.create({
      nom,
      arrivee: new Date()
    });

    await sendMessage(senderId, `✅ ${nom} est enregistré en garde.`);
    return;
  }

  // ARRIVEE
  if (text === "arrivee") {
    await sendMessage(senderId, "⚠️ Utilise : nom TonPrenom");
    return;
  }

  // DEPART
  if (text.startsWith("depart ")) {
    const nom = messageText.substring(7).trim();

    const garde = await Garde.findOne({
      nom,
      depart: null
    }).sort({ arrivee: -1 });

    if (!garde) {
      await sendMessage(senderId, "❌ Aucune garde active trouvée.");
      return;
    }

    garde.depart = new Date();
    await garde.save();

    await sendMessage(senderId, `🔚 ${nom} a terminé sa garde.`);
    return;
  }

  // QUI EST EN GARDE
  if (text === "en garde") {
    const gardes = await Garde.find({ depart: null });

    if (gardes.length === 0) {
      await sendMessage(senderId, "👀 Personne n'est en garde.");
      return;
    }

    const liste = gardes.map(g => `• ${g.nom}`).join("\n");
    await sendMessage(senderId, `🟢 En garde :\n${liste}`);
    return;
  }

  await sendMessage(senderId, "❓ Commandes disponibles:\n- nom TonPrenom\n- depart TonPrenom\n- en garde");
}

// =======================
// 📤 Envoi message
// =======================
async function sendMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: { text }
      }
    );
  } catch (error) {
    console.error("❌ Erreur envoi message:", error.response?.data || error.message);
  }
}
