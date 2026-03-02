const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";
const MONGO_URI = process.env.MONGO_URI;

// =======================
// Connexion MongoDB
// =======================

mongoose.connect(MONGO_URI)
.then(() => console.log("✅ Connecté à MongoDB"))
.catch(err => console.log("❌ Erreur MongoDB :", err));

// =======================
// Modèle Garde
// =======================

const gardeSchema = new mongoose.Schema({
  nom: String,
  arrivee: Date,
  depart: Date
});

const Garde = mongoose.model("Garde", gardeSchema);

// =======================
// Stockage temporaire
// =======================

let utilisateurs = {};
let gardesActives = {};

// =======================
// Webhook GET
// =======================

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.send("Erreur token");
  }
});

// =======================
// Webhook POST
// =======================

app.post("/webhook", async (req, res) => {
  const event = req.body.entry?.[0]?.messaging?.[0];
  if (!event) return res.sendStatus(200);

  const sender = event.sender.id;

  if (event.message && event.message.text) {
    const text = event.message.text.toLowerCase();

    // ================= NOM =================
    if (text.startsWith("nom ")) {
      const nom = text.replace("nom ", "");
      utilisateurs[sender] = nom;
      return sendMessage(sender, `✅ Nom enregistré : ${nom}`);
    }

    // ================= ARRIVEE =================
    if (text === "arrivee") {
      if (!utilisateurs[sender]) {
        return sendMessage(sender, "⚠️ Enregistre ton nom avec : nom TonPrenom");
      }

      gardesActives[sender] = new Date();
      return sendMessage(sender, "✅ Arrivée enregistrée !");
    }

    // ================= DEPART =================
    if (text === "depart") {
      if (!gardesActives[sender]) {
        return sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
      }

      const debut = gardesActives[sender];
      const fin = new Date();

      await Garde.create({
        nom: utilisateurs[sender],
        arrivee: debut,
        depart: fin
      });

      delete gardesActives[sender];

      return sendMessage(sender, "🕒 Garde enregistrée !");
    }

    // ================= QUI EST EN GARDE =================
    if (text === "garde") {
      if (Object.keys(gardesActives).length === 0) {
        return sendMessage(sender, "❌ Personne n’est en garde actuellement.");
      }

      let message = "👮 En garde actuellement :\n";
      for (let id in gardesActives) {
        message += `- ${utilisateurs[id]}\n`;
      }

      return sendMessage(sender, message);
    }

    // ================= JOUR =================
    if (text === "jour") {
      const today = new Date();
      today.setHours(0,0,0,0);

      const gardes = await Garde.find({
        arrivee: { $gte: today }
      });

      if (gardes.length === 0) {
        return sendMessage(sender, "📅 Aucune garde aujourd'hui.");
      }

      let message = "📅 Gardes du jour :\n";
      gardes.forEach(g => {
        message += `- ${g.nom} | ${g.arrivee.toLocaleTimeString()} - ${g.depart.toLocaleTimeString()}\n`;
      });

      return sendMessage(sender, message);
    }

    // ================= HISTORIQUE =================
    if (text === "historique") {
      const gardes = await Garde.find().sort({ arrivee: -1 }).limit(20);

      if (gardes.length === 0) {
        return sendMessage(sender, "📜 Aucun historique.");
      }

      let message = "📜 Historique :\n";
      gardes.forEach(g => {
        message += `- ${g.nom} | ${g.arrivee.toLocaleDateString()} ${g.arrivee.toLocaleTimeString()}\n`;
      });

      return sendMessage(sender, message);
    }

    return sendMessage(sender, "Commande inconnue.\nTape : arrivee, depart, garde, jour, historique");
  }

  res.sendStatus(200);
});

// =======================
// Envoyer message
// =======================

function sendMessage(sender, text) {
  return axios.post(
    `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: sender },
      message: { text },
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Bot démarré"));
