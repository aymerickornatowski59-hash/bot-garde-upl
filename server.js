const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";

// Stockage en mémoire
let gardesActives = {};

// 🔹 Vérification Webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook vérifié");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// 🔹 Réception des messages
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event) return res.sendStatus(200);

    const sender = event.sender.id;

    if (event.message && event.message.text) {
      const text = event.message.text.toLowerCase();

      // ARRIVEE
      if (text === "arrivee") {
        gardesActives[sender] = {
          debut: new Date(),
          nom: sender
        };

        await sendMessage(sender, "✅ Arrivée enregistrée !");
      }

      // DEPART
      else if (text === "depart") {
        if (!gardesActives[sender]) {
          await sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
        } else {
          const debut = gardesActives[sender].debut;
          const fin = new Date();
          const duree = Math.floor((fin - debut) / 60000);

          const log = `${sender} | ${debut} | ${fin} | ${duree} minutes\n`;
          fs.appendFileSync("historique.txt", log);

          delete gardesActives[sender];

          await sendMessage(sender, `🕒 Garde terminée : ${duree} minutes`);
        }
      }

      // VOIR QUI EST EN GARDE
      else if (text === "garde") {
        const actifs = Object.keys(gardesActives);

        if (actifs.length === 0) {
          await sendMessage(sender, "👮 Personne n'est en garde actuellement.");
        } else {
          let message = "👮 En garde actuellement :\n";

          actifs.forEach(id => {
            const minutes = Math.floor(
              (new Date() - gardesActives[id].debut) / 60000
            );
            message += `• ${id} (${minutes} min)\n`;
          });

          await sendMessage(sender, message);
        }
      }

      else {
        await sendMessage(sender, "Commande inconnue.\nTape : arrivee, depart ou garde");
      }
    }

    res.sendStatus(200);

  } catch (error) {
    console.log("❌ Erreur webhook :", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// 🔹 Fonction envoi message
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
    console.log("❌ Erreur envoi message :", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur démarré sur le port", PORT));
