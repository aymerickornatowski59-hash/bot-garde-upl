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
  .then(async () => {
    console.log("✅ Connexion MongoDB réussie");

    app.listen(PORT, async () => {
      console.log("🚀 Bot démarré sur le port " + PORT);

      try {
        await setPersistentMenu();
      } catch (err) {
        console.log("⚠️ Menu déjà configuré ou erreur API");
      }
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

// =======================
// 🧠 LOGIQUE BOT
// =======================
async function handleMessage(senderId, text) {
  if (!text) return;
  text = text.toLowerCase();

  let user = await User.findOne({ messengerId: senderId });

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

    await sendMessage(senderId, `🟢 ${user.nom} est en garde.`);
    return;
  }

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

  if (text === "resume") {
    const today = new Date().toISOString().split("T")[0];
    const gardes = await Garde.find({ date: today });

    if (gardes.length === 0) {
      await sendMessage(senderId, "📅 Aucune garde aujourd’hui.");
      return;
    }

    const liste = gardes.map(g => {
      const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");
      const depart = g.depart
        ? new Date(g.depart).toLocaleTimeString("fr-FR")
        : "En cours";

      return `• ${g.nom}\n   🕒 ${arrivee} → ${depart}`;
    }).join("\n\n");

    await sendMessage(senderId, `📅 Résumé du jour (${today}) :\n\n${liste}`);
    return;
  }

  if (text === "historique") {
    const gardes = await Garde.find()
      .sort({ arrivee: -1 })
      .limit(5);

    if (gardes.length === 0) {
      await sendMessage(senderId, "📚 Aucun historique.");
      return;
    }

    const liste = gardes.map(g => {
      const date = new Date(g.arrivee).toLocaleDateString("fr-FR");
      const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");
      const depart = g.depart
        ? new Date(g.depart).toLocaleTimeString("fr-FR")
        : "En cours";

      return `• ${g.nom}\n   📆 ${date}\n   🕒 ${arrivee} → ${depart}`;
    }).join("\n\n");

    await sendMessage(senderId, `📚 Historique récent :\n\n${liste}`);
    return;
  }

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
// 🔘 QUICK REPLIES
// =======================
cron.schedule("0 20 * * *", async () => {

// =======================
// 📌 MENU PERSISTANT
// =======================
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
            { type: "postback", title: "👀 En garde", payload: "en garde" },
            { type: "postback", title: "📅 Résumé", payload: "resume" },
            { type: "postback", title: "📚 Historique", payload: "historique" }
          ]
        }
      ]
    }
  );

  console.log("✅ Menu persistant activé");
}

// =======================
// 📅 Résumé automatique (test 1 min)
// =======================
cron.schedule("0 20 * * *", async () => {
  console.log("📊 Envoi résumé automatique...");

  const today = new Date().toISOString().split("T")[0];
  const gardes = await Garde.find({ date: today });
  const users = await User.find();

  if (gardes.length === 0) return;

  const liste = gardes.map(g => {
    const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");
    const depart = g.depart
      ? new Date(g.depart).toLocaleTimeString("fr-FR")
      : "En cours";

    return `• ${g.nom} : ${arrivee} → ${depart}`;
  }).join("\n");

  const message = `📅 Résumé automatique (${today})\n\n${liste}`;

  for (const user of users) {
    await sendMessage(user.messengerId, message);
  }

  console.log("✅ Résumé envoyé");
});
