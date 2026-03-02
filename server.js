const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";

let pointages = {};

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.send("Erreur token");
  }
});

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

function sendMessage(sender, text) {
  axios.post(
    `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: sender },
      message: { text },
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot démarré"));
