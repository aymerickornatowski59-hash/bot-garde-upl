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
.then(async ()=>{

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

/* =========================
Variables temporaires
========================= */

let attenteResumePhoto={}
let photoTemp={}
let attenteMortalite={}
let attenteNiveau={}
let attenteRapport={}
let alerteActive=null

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

const url=attachments[0].payload.url

photoTemp[senderId]=url
attenteResumePhoto[senderId]=true

await sendMessage(senderId,"📝 Décris l'incident pour accompagner la photo")

}

/* =========================
BOT
========================= */

async function handleMessage(senderId,text){

if(!text)return

text=text.toLowerCase()

let user=await User.findOne({messengerId:senderId})

/* INCIDENT PHOTO */

if(attenteResumePhoto[senderId]){

const photo=photoTemp[senderId]

const users=await User.find()

for(const u of users){

await axios.post(
`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
{
recipient:{id:u.messengerId},
message:{
attachment:{
type:"image",
payload:{url:photo}
}
}
}
)

await sendMessage(u.messengerId,
`🚨 INCIDENT

👤 ${user.nom}
🕒 ${new Date().toLocaleString("fr-FR")}

📝 ${text}`
)

}

attenteResumePhoto[senderId]=false
delete photoTemp[senderId]

await sendMenu(senderId,"✅ Incident envoyé")

return
}

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

await Garde.create({
messengerId:senderId,
nom:user.nom,
arrivee:new Date()
})

await sendMenu(senderId,`🟢 ${user.nom} est en garde`)

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

await sendMenu(senderId,`🔴 ${user.nom} a quitté la garde`)

return
}

/* EN GARDE */

if(text==="en garde"){

const gardes=await Garde.find({depart:null})

const liste=gardes.map(g=>"• "+g.nom).join("\n")

await sendMenu(senderId,"👀 En garde :\n"+liste)

return
}

/* MORTALITE */

if(text==="mortalite"){

attenteMortalite[senderId]=true

await sendMessage(senderId,"Combien de poissons morts ?")

return
}

if(attenteMortalite[senderId]){

await Mortalite.create({
nom:user.nom,
quantite:text,
date:new Date()
})

await sendMenu(senderId,"🐟 Mortalité enregistrée")

attenteMortalite[senderId]=false

return
}

/* NIVEAU */

if(text==="niveau"){

attenteNiveau[senderId]=true

await sendMessage(senderId,"Niveau ? normal / bas / critique")

return
}

if(attenteNiveau[senderId]){

await Niveau.create({
niveau:text,
nom:user.nom,
date:new Date()
})

await sendMenu(senderId,`💧 Niveau eau : ${text}`)

attenteNiveau[senderId]=false

return
}

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
Rapport automatique
========================= */

cron.schedule("0 20 * * *",async()=>{

const today=new Date().toISOString().split("T")[0]

const gardes=await Garde.find({date:today})

const msg=gardes.map(g=>{
const a=new Date(g.arrivee).toLocaleTimeString("fr-FR")
const d=g.depart?new Date(g.depart).toLocaleTimeString("fr-FR"):"En cours"
return `${g.nom} ${a}→${d}`
}).join("\n")

const users=await User.find()

for(const u of users){
await sendMessage(u.messengerId,`📅 Rapport du jour\n\n${msg}`)
}

})
