const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI manquant !");
  process.exit(1);
}

// =======================
// 🔥 Connexion MongoDB
// =======================
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connexion MongoDB réussie");

    app.listen(PORT, () => {
      console.log("🚀 Bot démarré sur le port " + PORT);
    });
  })
  .catch(err => {
    console.error("❌ Erreur MongoDB :", err.message);
  });


// =======================
// 📦 Schema
// =======================
const gardeSchema = new mongoose.Schema({
  nom: String,
  arrivee: Date,
  depart: Date,
  date: {
    type: String,
    default: () => new Date().toISOString().split("T")[0]
  }
});

const Garde = mongoose.model("Garde", gardeSchema);


// =======================
// 🟢 ARRIVÉE
// =======================
app.post("/arrivee", async (req, res) => {
  const { nom } = req.body;

  if (!nom) {
    return res.json({ message: "❌ Nom manquant" });
  }

  const nouvelleGarde = new Garde({
    nom,
    arrivee: new Date()
  });

  await nouvelleGarde.save();

  res.json({
    message: `✅ ${nom} est en garde`,
    heure: nouvelleGarde.arrivee
  });
});


// =======================
// 🔴 DÉPART
// =======================
app.post("/depart", async (req, res) => {
  const { nom } = req.body;

  const garde = await Garde.findOne({
    nom,
    depart: null
  }).sort({ arrivee: -1 });

  if (!garde) {
    return res.json({ message: "❌ Aucune garde active trouvée" });
  }

  garde.depart = new Date();
  await garde.save();

  res.json({
    message: `🔚 ${nom} a terminé sa garde`,
    arrivee: garde.arrivee,
    depart: garde.depart
  });
});


// =======================
// 👀 QUI EST EN GARDE
// =======================
app.get("/en-garde", async (req, res) => {
  const gardes = await Garde.find({ depart: null });

  res.json(gardes);
});


// =======================
// 📅 GARDES DU JOUR
// =======================
app.get("/garde-jour", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const gardes = await Garde.find({ date: today });

  res.json(gardes);
});


// =======================
// 📚 HISTORIQUE COMPLET
// =======================
app.get("/historique", async (req, res) => {
  const gardes = await Garde.find().sort({ arrivee: -1 });

  res.json(gardes);
});
