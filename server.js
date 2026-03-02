const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = "garde123";

let gardesActives = {};
let utilisateurs = {};
let historique = [];

// Charger historique si existant
if (fs.existsSync("historique.json")) {
  historique = JSON.parse(fs.readFileSync("historique.json"));
}

// 🔹 Format date
function formatDate(date) {
  return date.toLocaleString("fr-FR");
}

// 🔹 Sauvegarde fichier
function sauvegarderHistorique() {
  fs.writeFileSync("historique.json", JSON.stringify(historique, null, 2));
}

// 🔹 Vérification webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// 🔹 Réception messages
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.entry?.[0]?.messaging?.[0];
    if (!event) return res.sendStatus(200);

    const sender = event.sender.id;

    if (event.message?.text) {
      const text = event.message.text.toLowerCase();

      // 🔹 ENREGISTRER NOM
      if (text.startsWith("nom ")) {
        const prenom = text.replace("nom ", "").trim();
        utilisateurs[sender] = prenom;
        return sendMessage(sender, `✅ Nom enregistré : ${prenom}`);
      }

      // 🔹 ARRIVEE
      if (text === "arrivee") {
        if (!utilisateurs[sender]) {
          return sendMessage(sender, "⚠️ Enregistre ton nom avec : nom TonPrenom");
        }

        gardesActives[sender] = {
          debut: new Date()
        };

        return sendMessage(sender, "✅ Arrivée enregistrée !");
      }

      // 🔹 DEPART
      if (text === "depart") {
        if (!gardesActives[sender]) {
          return sendMessage(sender, "⛔ Pas d'arrivée enregistrée.");
        }

        const debut = gardesActives[sender].debut;
        const fin = new Date();
        const prenom = utilisateurs[sender] || "Inconnu";

        historique.push({
          nom: prenom,
          debut: debut,
          fin: fin
        });

        sauvegarderHistorique();

        delete gardesActives[sender];

        return sendMessage(
          sender,
          `🕒 Garde terminée\nArrivée : ${formatDate(debut)}\nDépart : ${formatDate(fin)}`
        );
      }

      // 🔹 QUI EST EN GARDE
      if (text === "garde") {
        const actifs = Object.keys(gardesActives);

        if (actifs.length === 0) {
          return sendMessage(sender, "👮 Personne en garde actuellement.");
        }

        let message = "👮 En garde actuellement :\n\n";

        actifs.forEach(id => {
          const prenom = utilisateurs[id] || "Inconnu";
          const minutes = Math.floor(
            (new Date() - gardesActives[id].debut) / 60000
          );

          message += `• ${prenom} (${minutes} min)\n`;
        });

        return sendMessage(sender, message);
      }

      // 🔹 JOUR (GARDES DU JOUR)
      if (text === "jour") {
        const aujourdHui = new Date().toDateString();

        const gardesJour = historique.filter(g =>
          new Date(g.debut).toDateString() === aujourdHui
        );

        if (gardesJour.length === 0) {
          return sendMessage(sender, "📅 Aucune garde aujourd'hui.");
        }

        let message = "📅 Gardes du jour :\n\n";

        gardesJour.forEach(g => {
          message += `• ${g.nom}\n`;
          message += `  Arrivée : ${formatDate(new Date(g.debut))}\n`;
          message += `  Départ : ${formatDate(new Date(g.fin))}\n\n`;
        });

        return sendMessage(sender, message);
      }

      // 🔹 HISTORIQUE COMPLET
      if (text === "historique") {
        if (historique.length === 0) {
          return sendMessage(sender, "📂 Aucun historique.");
        }

        let message = "📂 Historique complet :\n\n";

        historique.forEach(g => {
          message += `• ${g.nom}\n`;
          message += `  Date : ${new Date(g.debut).toLocaleDateString("fr-FR")}\n`;
          message += `  Arrivée : ${formatDate(new Date(g.debut))}\n`;
          message += `  Départ : ${formatDate(new Date(g.fin))}\n\n`;
        });

        return sendMessage(sender, message);
      }

      return sendMessage(
        sender,
        "Commandes disponibles :\n\n- nom TonPrenom\n- arrivee\n- depart\n- garde\n- jour\n- historique"
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

// 🔹 Envoi message
async function sendMessage(sender, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/me/messages`,
      {
        recipient: { id: sender },
        message: { text }
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN }
      }
    );
  } catch (error) {
    console.log("Erreur envoi message:", error.response?.data);
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur démarré"));
