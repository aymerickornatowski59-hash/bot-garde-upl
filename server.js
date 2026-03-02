const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

// =============================
// VARIABLES ENV
// =============================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";
const MONGODB_URI = process.env.MONGODB_URI;

// =============================
// CONNEXION MONGODB
// =============================
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ Connecté à MongoDB"))
  .catch(err => console.log("❌ Erreur MongoDB :", err));

// =============================
// MODELES
// =============================
const gardeSchema = new mongoose.Schema({
  userId: String,
  nom: String,
  arrivee: Date,
  depart: Date
});

const Garde = mongoose.model("Garde", gardeSchema);

const userSchema = new mongoose.Schema({
  userId: String,
  nom: String
});

const User = mongoose.model("User", userSchema);

// =============================
// WEBHOOK VERIFY
// =============================
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.send("Erreur token");
  }
});

// =============================
// WEBHOOK POST
// =============================
app.post("/webhook", async (req, res) => {
  const event = req.body.entry?.[0]?.messaging?.[0];
  if (!event) return res.sendStatus(200);

  const sender = event.sender.id;

  if (event.message && event.message.text) {
    const text = event.message.text.toLowerCase();

    // =============================
    // ENREGISTRER NOM
    // =============================
    if (text.startsWith("nom ")) {
      const nom = text.replace("nom ", "").trim();

      await User.findOneAndUpdate(
        { userId: sender },
        { nom },
        { upsert: true }
      );

      return sendMessage(sender, `✅ Nom enregistré : ${nom}`);
    }

    const user = await User.findOne({ userId: sender });

    if (!user) {
      return sendMessage(sender, "⚠️ Enregistre ton nom avec : nom TonPrenom");
    }

    // =============================
    // ARRIVEE
    // =============================
    if (text === "arrivee") {

      const dejaEnCours = await Garde.findOne({
        userId: sender,
        depart: null
      });

      if (dejaEnCours) {
        return sendMessage(sender, "⚠️ Tu es déjà en garde.");
      }

      await Garde.create({
        userId: sender,
        nom: user.nom,
        arrivee: new Date(),
        depart: null
      });

      return sendMessage(sender, "✅ Arrivée enregistrée !");
    }

    // =============================
    // DEPART
    // =============================
    if (text === "depart") {

      const garde = await Garde.findOne({
        userId: sender,
        depart: null
      });

      if (!garde) {
        return sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
      }

      garde.depart = new Date();
      await garde.save();

      const duree = Math.floor((garde.depart - garde.arrivee) / 60000);

      return sendMessage(sender, `🕒 Garde terminée : ${duree} minutes`);
    }

    // =============================
    // QUI EST EN GARDE
    // =============================
    if (text === "garde") {

      const enCours = await Garde.find({ depart: null });

      if (enCours.length === 0) {
        return sendMessage(sender, "📭 Personne n'est en garde actuellement.");
      }

      let message = "👮 En garde actuellement :\n\n";

      enCours.forEach(g => {
        message += `• ${g.nom} (depuis ${g.arrivee.toLocaleTimeString()})\n`;
      });

      return sendMessage(sender, message);
    }

    // =============================
    // GARDES DU JOUR
    // =============================
    if (text === "jour") {

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const gardes = await Garde.find({
        arrivee: { $gte: today }
      });

      if (gardes.length === 0) {
        return sendMessage(sender, "📭 Aucune garde aujourd’hui.");
      }

      let message = "📅 Gardes du jour :\n\n";

      gardes.forEach(g => {
        message += `• ${g.nom}\n`;
        message += `  Arrivée : ${g.arrivee.toLocaleTimeString()}\n`;
        message += `  Départ : ${g.depart ? g.depart.toLocaleTimeString() : "En cours"}\n\n`;
      });

      return sendMessage(sender, message);
    }

    // =============================
    // HISTORIQUE COMPLET
    // =============================
    if (text === "historique") {

      const gardes = await Garde.find().sort({ arrivee: -1 });

      if (gardes.length === 0) {
        return sendMessage(sender, "📭 Aucun historique.");
      }

      let message = "📚 Historique complet :\n\n";

      gardes.forEach(g => {
        message += `• ${g.nom}\n`;
        message += `  Date : ${g.arrivee.toLocaleDateString()}\n`;
        message += `  Arrivée : ${g.arrivee.toLocaleTimeString()}\n`;
        message += `  Départ : ${g.depart ? g.depart.toLocaleTimeString() : "En cours"}\n\n`;
      });

      return sendMessage(sender, message);
    }

    return sendMessage(sender, "Commande inconnue.\nTape : arrivee, depart, garde, jour, historique");
  }

  res.sendStatus(200);
});

// =============================
// ENVOI MESSAGE FACEBOOK
// =============================
async function sendMessage(sender, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: sender },
        message: { text },
      }
    );
  } catch (error) {
    console.log("Erreur envoi message :", error.response?.data || error.message);
  }
}

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Bot démarré"));
