const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

/* =========================
   🔒 Politique de confidentialité
========================= */
app.get("/privacy", (req, res) => {
  res.send(`
    <h1>Politique de confidentialité - Bot Garde UPL</h1>
    <p>Ce bot enregistre uniquement :</p>
    <ul>
      <li>Le prénom fourni par l'utilisateur</li>
      <li>Les horaires d'arrivée et de départ</li>
    </ul>
    <p>Aucune donnée n’est partagée avec des tiers.</p>
    <p>Les données sont stockées uniquement pour le suivi interne des gardes.</p>
  `);
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

/* =========================
   🔥 Connexion MongoDB
========================= */
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connexion MongoDB réussie");

    app.listen(PORT, async () => {
      console.log("🚀 Bot démarré sur le port " + PORT);

      try {
         await setGetStarted();
         await resetMessengerMenu();
         await setPersistentMenu();
      } catch (err) {
        console.log("⚠️ Menu déjà configuré ou erreur API");
      }
    });
  })
  .catch(err => {
    console.error("❌ Erreur MongoDB :", err.message);
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
   🔐 Vérification Webhook
========================= */
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

/* =========================
   📩 Webhook réception
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
   🧠 LOGIQUE BOT
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
  if (text === "classement") {

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const gardes = await Garde.find({
    depart: { $ne: null }
  });

  const stats = {};

  for (const g of gardes) {
    const date = new Date(g.arrivee);

    if (
      date.getMonth() === currentMonth &&
      date.getFullYear() === currentYear
    ) {
      const duration = (new Date(g.depart) - new Date(g.arrivee)) / 1000;

      if (!stats[g.nom]) {
        stats[g.nom] = {
          total: 0,
          count: 0
        };
      }

      stats[g.nom].total += duration;
      stats[g.nom].count += 1;
    }
  }

  const classement = Object.entries(stats)
    .sort((a, b) => b[1].total - a[1].total);

  if (classement.length === 0) {
    await sendMessage(senderId, "📊 Aucun pointage ce mois-ci.");
    return;
  }

  const mois = now.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric"
  });

  const message = classement.map((entry, index) => {
    const nom = entry[0];
    const totalSeconds = entry[1].total;
    const count = entry[1].count;

    const heures = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    let medal = "";
    if (index === 0) medal = "🥇";
    else if (index === 1) medal = "🥈";
    else if (index === 2) medal = "🥉";

    return `${medal} ${nom} — ${count} garde(s) — ${heures}h${minutes
      .toString()
      .padStart(2, "0")}`;
  }).join("\n");

  await sendMessage(senderId, `📊 Classement ${mois} :\n\n${message}`);
  return;
}

  await sendMessage(senderId, "Utilise le menu en bas 👇");
}

/* =========================
   📤 ENVOI MESSAGE
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
   📌 GET STARTED
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

  console.log("✅ Get Started activé");
}

/* =========================
   📌 MENU PERSISTANT
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
            {
              type: "postback",
              title: "🟢 Arrivée",
              payload: "arrivee"
            },
            {
              type: "postback",
              title: "🔴 Départ",
              payload: "depart"
            },
            {
              type: "postback",
              title: "👀 En garde",
              payload: "en garde"
            },
            {
              type: "postback",
              title: "📅 Résumé",
              payload: "resume"
            },
            {
              type: "postback",
              title: "📚 Historique",
              payload: "historique"
            },
            {
              type: "postback",
              title: "🏆 Classement",
              payload: "classement"
            }
          ]
        }
      ]
    }
  );

  console.log("✅ Menu persistant activé");
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

  console.log("🧹 Ancien menu supprimé");
}
/* =========================
   📅 Résumé automatique à 20h
========================= */
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
