const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

// Variables d'environnement
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";

let pointages = {};

// Route test (évite Cannot GET /)
app.get("/", (req, res) => {
  res.send("✅ Bot garde UPL en ligne !");
});

// Vérification Facebook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook vérifié");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Erreur de vérification");
    res.sendStatus(403);
  }
});

// Réception des messages
app.post("/webhook", (req, res) => {
  const event = req.body.entry?.[0]?.messaging?.[0];

  if (!event) return res.sendStatus(200);

  const sender = event.sender.id;

  if (event.message && event.message.text) {
    const text = event.message.text.toLowerCase();

    if (text === "arrivee") {
      pointages[sender] = new Date();
      sendMessage(sender, "✅ Arrivée enregistrée !");
    }

    if (text === "depart") {
      if (!pointages[sender]) {
        sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
      } else {
        const debut = pointages[sender];
        const fin = new Date();
        const duree = Math.floor((fin - debut) / 60000);

        const log = `${sender} | ${debut} | ${fin} | ${duree} minutes\n`;
        fs.appendFileSync("historique.txt", log);

        delete pointages[sender];

        sendMessage(sender, `🕒 Garde terminée : ${duree} minutes`);
      }
    }
  }

  res.sendStatus(200);
});

// Envoi message Messenger
async function sendMessage(sender, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/me/messages`,
      {
        recipient: { id: sender },
        message: { text },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
      }
    );
  } catch (error) {
    console.error("Erreur envoi message :", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
