const express = require("express")
const mongoose = require("mongoose")
const axios = require("axios")
const cron = require("node-cron")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000
const MONGODB_URI = process.env.MONGODB_URI
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN
const VERIFY_TOKEN = process.env.VERIFY_TOKEN

/* =========================
MongoDB
========================= */

mongoose.connect(MONGODB_URI)
.then(()=>{

console.log("✅ MongoDB connecté")

app.listen(PORT, async ()=>{

console.log("🚀 Bot démarré")

try{
await setGetStarted()
await resetMessengerMenu()
await setPersistentMenu()
}catch(e){}

})

})
.catch(err=>console.log(err))

/* =========================
Schemas
========================= */

const userSchema = new mongoose.Schema({
messengerId:String,
nom:String
})

const gardeSchema = new mongoose.Schema({
messengerId:String,
nom:String,
arrivee:Date,
depart:Date,
date:{
type:String,
default:()=>new Date().toISOString().split("T")[0]
}
})

const alertSchema = new mongoose.Schema({
type:String,
createur:String,
debut:Date,
fin:Date,
rapport:String
})

const mortaliteSchema = new mongoose.Schema({
nom:String,
quantite:Number,
date:Date
})

const niveauSchema = new mongoose.Schema({
niveau:String,
nom:String,
date:Date
})

const User = mongoose.model("User",userSchema)
const Garde = mongoose.model("Garde",gardeSchema)
const Alert = mongoose.model("Alert",alertSchema)
const Mortalite = mongoose.model("Mortalite",mortaliteSchema)
const Niveau = mongoose.model("Niveau",niveauSchema)

let alertActive=null
let attenteRapport={}
let attenteMortalite={}
let attenteNiveau={}

/* =========================
Webhook
========================= */

app.get("/webhook",(req,res)=>{

if(req.query["hub.verify_token"]===VERIFY_TOKEN){
return res.status(200).send(req.query["hub.challenge"])
}

res.sendStatus(403)

})

app.post("/webhook",async(req,res)=>{

const body=req.body

if(body.object==="page"){

for(const entry of body.entry){

for(const event of entry.messaging){

if(event.message){

const text=event.message.text
const payload=event.message.quick_reply?.payload

if(event.message.attachments){
await handlePhoto(event.sender.id,event.message.attachments)
}else{
await handleMessage(event.sender.id,payload||text)
}

}

if(event.postback){
await handleMessage(event.sender.id,event.postback.payload)
}

}

}

res.status(200).send("EVENT_RECEIVED")

}else{
res.sendStatus(404)
}

})

/* =========================
Envoi message
========================= */

async function sendMessage(senderId,text){

await axios.post(
`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
{
recipient:{id:senderId},
message:{text}
}
)

}

async function sendToAll(text){

const users=await User.find()

for(const u of users){
try{
await sendMessage(u.messengerId,text)
}catch{}
}

}

/* =========================
Menu
========================= */

async function sendMenu(senderId,text="Choisis une action 👇"){

await axios.post(
`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
{
recipient:{id:senderId},
message:{
text,
quick_replies:[
{content_type:"text",title:"🟢 Arrivée",payload:"arrivee"},
{content_type:"text",title:"🔴 Départ",payload:"depart"},
{content_type:"text",title:"👀 En garde",payload:"en garde"},
{content_type:"text",title:"📅 Résumé",payload:"resume"},
{content_type:"text",title:"📚 Historique",payload:"historique"},
{content_type:"text",title:"🏆 Classement",payload:"classement"},
{content_type:"text",title:"🚨 Alerte",payload:"alerte"},
{content_type:"text",title:"📋 Alertes",payload:"alertes"},
{content_type:"text",title:"🐟 Mortalité",payload:"mortalite"},
{content_type:"text",title:"💧 Niveau eau",payload:"niveau"},
{content_type:"text",title:"✅ Fin alerte",payload:"fin alerte"}
]
}
}
)

}

/* =========================
Photo incident
========================= */

async function handlePhoto(senderId,attachments){

const user=await User.findOne({messengerId:senderId})

await sendToAll(`📷 Incident signalé par ${user?.nom||"quelqu'un"}`)

}

/* =========================
BOT
========================= */

async function handleMessage(senderId,text){

if(!text)return

text=text.toLowerCase()

let user=await User.findOne({messengerId:senderId})

/* NOM */

if(text.startsWith("nom ")){

const nom=text.replace("nom ","")

if(!user){
user=new User({messengerId:senderId,nom})
}else{
user.nom=nom
}

await user.save()

await sendMenu(senderId,"✅ Nom enregistré")
return
}

/* ARRIVEE */

if(text==="arrivee"){

if(!user){
await sendMenu(senderId,"⚠️ Enregistre ton nom")
return
}

const deja=await Garde.findOne({messengerId:senderId,depart:null})

if(deja){
await sendMenu(senderId,"⚠️ Tu es déjà en garde")
return
}

await Garde.create({
messengerId:senderId,
nom:user.nom,
arrivee:new Date()
})

await sendToAll(`🟢 ${user.nom} vient de prendre la garde`)

await sendMenu(senderId)
return
}

/* DEPART */

if(text==="depart"){

const garde=await Garde.findOne({messengerId:senderId,depart:null})

if(!garde){
await sendMenu(senderId,"❌ Aucune garde active")
return
}

garde.depart=new Date()
await garde.save()

await sendToAll(`🔴 ${user.nom} a quitté la garde`)

await sendMenu(senderId)
return
}

/* EN GARDE */

if(text==="en garde"){

const gardes=await Garde.find({depart:null})

if(gardes.length===0){
await sendMenu(senderId,"👀 Personne en garde")
return
}

const liste=gardes.map(g=>"• "+g.nom).join("\n")

await sendMenu(senderId,"👀 En garde :\n"+liste)
return
}

/* RESUME */

if(text==="resume"){

const today=new Date().toISOString().split("T")[0]

const gardes=await Garde.find({date:today})

const liste=gardes.map(g=>{

const a=new Date(g.arrivee).toLocaleTimeString("fr-FR")

const d=g.depart?new Date(g.depart).toLocaleTimeString("fr-FR"):"En cours"

return `• ${g.nom} ${a} → ${d}`

}).join("\n")

await sendMenu(senderId,"📅 Résumé\n\n"+liste)
return
}

/* HISTORIQUE */

if(text==="historique"){

const gardes=await Garde.find().sort({arrivee:-1}).limit(10)

const liste=gardes.map(g=>{
const d=new Date(g.arrivee).toLocaleDateString("fr-FR")
return `• ${g.nom} (${d})`
}).join("\n")

await sendMenu(senderId,"📚 Historique\n\n"+liste)
return
}

/* CLASSEMENT */

if(text==="classement"){

const gardes=await Garde.find({depart:{$ne:null}})

const stats={}

for(const g of gardes){

const duration=(new Date(g.depart)-new Date(g.arrivee))/1000

if(!stats[g.nom])stats[g.nom]=0

stats[g.nom]+=duration

}

const classement=Object.entries(stats)
.sort((a,b)=>b[1]-a[1])

const msg=classement.map((c,i)=>{

const h=Math.floor(c[1]/3600)

return `${i+1}. ${c[0]} — ${h}h`

}).join("\n")

await sendMenu(senderId,"🏆 Classement\n\n"+msg)
return
}

/* ALERTES HISTORIQUE */

if(text==="alertes"){

const alerts=await Alert.find().sort({debut:-1}).limit(10)

const msg=alerts.map(a=>{
const d=new Date(a.debut).toLocaleDateString("fr-FR")
return `🚨 ${a.type}\n${d}\n${a.rapport||""}`
}).join("\n\n")

await sendMenu(senderId,"📋 Historique alertes\n\n"+msg)
return
}

/* MORTALITE */

if(text==="mortalite"){

attenteMortalite[senderId]=true

await sendMessage(senderId,"Combien de poissons morts ?")

return
}

if(attenteMortalite[senderId]){

const q=parseInt(text)

const mort=new Mortalite({
nom:user.nom,
quantite:q,
date:new Date()
})

await mort.save()

await sendToAll(`🐟 Mortalité signalée\n${q} poissons\npar ${user.nom}`)

attenteMortalite[senderId]=false

await sendMenu(senderId)

return
}

/* NIVEAU EAU */

if(text==="niveau"){

attenteNiveau[senderId]=true

await sendMessage(senderId,"Niveau ? normal / bas / critique")

return
}

if(attenteNiveau[senderId]){

const niv=new Niveau({
niveau:text,
nom:user.nom,
date:new Date()
})

await niv.save()

await sendToAll(`💧 Niveau eau : ${text}\nsignalé par ${user.nom}`)

attenteNiveau[senderId]=false

await sendMenu(senderId)

return
}

/* ALERTES */

if(text==="alertes"){

const alerts = await Alert.find().sort({debut:-1}).limit(5)
const morts = await Mortalite.find().sort({date:-1}).limit(5)
const niveaux = await Niveau.find().sort({date:-1}).limit(5)

let historique = "📋 Historique incidents\n\n"

/* ALERTES */

alerts.forEach(a=>{

const d = new Date(a.debut).toLocaleDateString("fr-FR")

historique +=
`🚨 ${a.type}
📅 ${d}
👤 ${a.createur}
📝 ${a.rapport || "Aucun rapport"}

`

})

/* MORTALITE */

morts.forEach(m=>{

const d = new Date(m.date).toLocaleDateString("fr-FR")

historique +=
`🐟 Mortalité
📅 ${d}
👤 ${m.nom}
Quantité : ${m.quantite}

`

})

/* NIVEAU EAU */

niveaux.forEach(n=>{

const d = new Date(n.date).toLocaleDateString("fr-FR")

historique +=
`💧 Niveau eau
📅 ${d}
👤 ${n.nom}
Niveau : ${n.niveau}

`

})

await sendMenu(senderId, historique)

return
}
/* =========================
CONFIG MESSENGER
========================= */

async function setGetStarted(){

await axios.post(
`https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
{
get_started:{payload:"GET_STARTED"}
}
)

}

async function resetMessengerMenu(){

await axios.delete(
`https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
{
data:{fields:["persistent_menu"]}
}
)

}

async function setPersistentMenu(){

await axios.post(
`https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
{
persistent_menu:[
{
locale:"default",
composer_input_disabled:false,
call_to_actions:[
{type:"postback",title:"🟢 Arrivée",payload:"arrivee"},
{type:"postback",title:"🔴 Départ",payload:"depart"},
{type:"postback",title:"🚨 Alerte",payload:"alerte"}
]
}
]
}
)

}

/* =========================
RAPPORT AUTOMATIQUE
========================= */

cron.schedule("0 20 * * *",async()=>{

const today=new Date().toISOString().split("T")[0]

const gardes=await Garde.find({date:today})

const msg=gardes.map(g=>{
const a=new Date(g.arrivee).toLocaleTimeString("fr-FR")
const d=g.depart?new Date(g.depart).toLocaleTimeString("fr-FR"):"En cours"
return `${g.nom} ${a}→${d}`
}).join("\n")

await sendToAll(`📅 Rapport du jour\n\n${msg}`)

})
