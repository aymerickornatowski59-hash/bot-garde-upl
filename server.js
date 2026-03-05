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
   MongoDB
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
.catch(err => console.log(err));

/* =========================
   Schemas
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
   Webhook
========================= */

app.get("/webhook", (req, res) => {

  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }

  res.sendStatus(403);

});

app.post("/webhook", async (req, res) => {

  const body = req.body;

  if (body.object === "page") {

    for (const entry of body.entry) {

      for (const event of entry.messaging) {

        if (event.message) {

          const text = event.message.text;
          const payload = event.message.quick_reply?.payload;

          await handleMessage(event.sender.id, payload || text);

        }

        if (event.postback) {

          await handleMessage(event.sender.id, event.postback.payload);

        }

      }

    }

    res.status(200).send("EVENT_RECEIVED");

  } else {

    res.sendStatus(404);

  }

});

/* =========================
   Envoi message simple
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
   Menu avec boutons
========================= */

async function sendMenu(senderId, text = "Choisis une action 👇") {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: {
        text,
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
   Message à toute l'équipe
========================= */

async function sendToAll(text) {

  const users = await User.find();

  for (const user of users) {

    try {
      await sendMessage(user.messengerId, text);
    } catch (err) {
      console.log("Erreur envoi", user.messengerId);
    }

  }

}

/* =========================
   Logique BOT
========================= */

async function handleMessage(senderId, text) {

  if (!text) return;

  text = text.toLowerCase();

  let user = await User.findOne({ messengerId: senderId });

  /* START */

  if (text === "get_started") {

    await sendMessage(senderId, "👋 Bienvenue ! Enregistre ton nom avec : nom TonPrenom");
    return;

  }

  /* ENREGISTRER NOM */

  if (text.startsWith("nom ")) {

    const nom = text.replace("nom ", "");

    if (!user) {

      user = new User({
        messengerId: senderId,
        nom
      });

    } else {

      user.nom = nom;

    }

    await user.save();

    await sendMenu(senderId, `✅ Nom enregistré : ${nom}`);

    return;

  }

  /* ARRIVEE */

  if (text === "arrivee") {

    if (!user) {

      await sendMenu(senderId, "⚠️ Enregistre ton nom avec : nom TonPrenom");
      return;

    }

    const deja = await Garde.findOne({
      messengerId: senderId,
      depart: null
    });

    if (deja) {

      await sendMenu(senderId, "⚠️ Tu es déjà en garde");
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

  /* DEPART */

  if (text === "depart") {

    const garde = await Garde.findOne({
      messengerId: senderId,
      depart: null
    });

    if (!garde) {

      await sendMenu(senderId, "❌ Aucune garde active");
      return;

    }

    garde.depart = new Date();
    await garde.save();

    await sendToAll(`🔴 ${user.nom} a quitté la garde`);

    await sendMenu(senderId);

    return;

  }

  /* EN GARDE */

  if (text === "en garde") {

    const gardes = await Garde.find({ depart: null });

    if (gardes.length === 0) {

      await sendMenu(senderId, "👀 Personne en garde");
      return;

    }

    const liste = gardes.map(g => `• ${g.nom}`).join("\n");

    await sendMenu(senderId, `👀 En garde :\n${liste}`);

    return;

  }

  /* RESUME */

  if (text === "resume") {

    const today = new Date().toISOString().split("T")[0];

    const gardes = await Garde.find({ date: today });

    if (gardes.length === 0) {

      await sendMenu(senderId, "📅 Aucune garde aujourd'hui");
      return;

    }

    const liste = gardes.map(g => {

      const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");

      const depart = g.depart
        ? new Date(g.depart).toLocaleTimeString("fr-FR")
        : "En cours";

      return `• ${g.nom}\n🕒 ${arrivee} → ${depart}`;

    }).join("\n\n");

    await sendMenu(senderId, `📅 Résumé du jour\n\n${liste}`);

    return;

  }

  /* HISTORIQUE */

  if (text === "historique") {

    const gardes = await Garde.find()
      .sort({ arrivee: -1 })
      .limit(5);

    const liste = gardes.map(g => {

      const date = new Date(g.arrivee).toLocaleDateString("fr-FR");

      const arrivee = new Date(g.arrivee).toLocaleTimeString("fr-FR");

      const depart = g.depart
        ? new Date(g.depart).toLocaleTimeString("fr-FR")
        : "En cours";

      return `• ${g.nom}\n📆 ${date}\n🕒 ${arrivee} → ${depart}`;

    }).join("\n\n");

    await sendMenu(senderId, `📚 Historique\n\n${liste}`);

    return;

  }

  /* CLASSEMENT */

  if (text === "classement") {

    const gardes = await Garde.find({ depart: { $ne: null } });

    const stats = {};

    for (const g of gardes) {

      const duration = (new Date(g.depart) - new Date(g.arrivee)) / 1000;

      if (!stats[g.nom]) {

        stats[g.nom] = { total: 0, count: 0 };

      }

      stats[g.nom].total += duration;
      stats[g.nom].count++;

    }

    const classement = Object.entries(stats)
      .sort((a, b) => b[1].total - a[1].total);

    const message = classement.map((c, i) => {

      const nom = c[0];
      const total = c[1].total;

      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);

      return `${i + 1}. ${nom} — ${h}h${m}`;

    }).join("\n");

    await sendMenu(senderId, `🏆 Classement\n\n${message}`);

    return;

  }

  await sendMenu(senderId);

}

/* =========================
   Messenger config
========================= */

async function setGetStarted() {

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      get_started: { payload: "GET_STARTED" }
    }
  );

}

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
   Résumé automatique 20h
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
