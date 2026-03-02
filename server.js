const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";

let gardes = {}; // { senderId: { nom, debut } }

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.send("Erreur token");
  }
});

app.post("/webhook", async (req, res) => {
  const event = req.body.entry?.[0]?.messaging?.[0];
  if (!event) return res.sendStatus(200);

  const sender = event.sender.id;

  if (event.message && event.message.text) {
    const text = event.message.text.toLowerCase();

    // Enregistrement nom
    if (text.startsWith("nom ")) {
      const nom = text.replace("nom ", "");
      if (!gardes[sender]) gardes[sender] = {};
      gardes[sender].nom = nom;
      sendMessage(sender, `✅ Nom enregistré : ${nom}`);
    }

    // Arrivée
    else if (text === "arrivee") {
      if (!gardes[sender] || !gardes[sender].nom) {
        return sendMessage(sender, "⚠️ Enregistre ton nom avec : nom TonPrenom");
      }

      gardes[sender].debut = new Date();
      sendMessage(sender, "✅ Arrivée enregistrée !");
    }

    // Départ
    else if (text === "depart") {
      if (!gardes[sender] || !gardes[sender].debut) {
        return sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
      }

      const debut = gardes[sender].debut;
      const fin = new Date();
      const duree = Math.floor((fin - debut) / 60000);

      const log = `${gardes[sender].nom} | ${debut} | ${fin} | ${duree} minutes\n`;
      fs.appendFileSync("historique.txt", log);

      delete gardes[sender].debut;

      sendMessage(sender, `🕒 Garde terminée : ${duree} minutes`);
    }

    // Qui est en garde ?
    else if (text === "garde") {
      const enGarde = Object.values(gardes)
        .filter(g => g.debut)
        .map(g => `- ${g.nom} (depuis ${g.debut.toLocaleTimeString()})`);

      if (enGarde.length === 0) {
        sendMessage(sender, "👮 Personne n'est en garde actuellement.");
      } else {
        sendMessage(
          sender,
          "👮 Personnes actuellement en garde :\n\n" + enGarde.join("\n")
        );
      }
    }
  }

  res.sendStatus(200);
});

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
    console.log("Erreur envoi message :", error.response?.data);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot démarré"));
