const {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require("discord.js");

const cron = require("node-cron");
const { google } = require("googleapis");

// =====================================================
// 🔧 CONFIGURATION
// =====================================================

const RH_SHEET_NAME = "Comptabilité Général";
const BILAN_SHEET_NAME = "Récapitulatif Hebdo";
const VEHICULE_SHEET_NAME = "Véhicules";

const ROLES_CONFIG = {
  "Pizzaiolo Apprenti": { start: 43, end: 76 },
  "Pizzaiolo Confirmé": { start: 34, end: 42 },
  "Pizzaiolo Vétéran": { start: 26, end: 33 },
  "Vendeur": { start: 17, end: 24 }
};

const SHEET_ID = process.env.SHEET_ID;

// =====================================================
// 🤖 DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// =====================================================
// 📊 GOOGLE AUTH
// =====================================================

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// =====================================================
// 📅 READY + CRON AUTOMATIQUE
// =====================================================

client.once("ready", async () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);

  cron.schedule("55 23 * * 0", async () => {
    console.log("⏰ Génération automatique du bilan...");

    try {
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SHEET_ID,
        ranges: [
          `${BILAN_SHEET_NAME}!F32`,
          `${BILAN_SHEET_NAME}!J32`,
          `${BILAN_SHEET_NAME}!I39`,
          `${BILAN_SHEET_NAME}!I40`,
          `${BILAN_SHEET_NAME}!I41`
        ]
      });

      const values = res.data.valueRanges;

      const totalCA = values[0].values?.[0]?.[0] || "0";
      const totalDepenses = values[1].values?.[0]?.[0] || "0";
      const benefAvant = values[2].values?.[0]?.[0] || "0";
      const taxe = values[3].values?.[0]?.[0] || "0";
      const benefNet = values[4].values?.[0]?.[0] || "0";

      const channel = client.channels.cache.find(
        ch => ch.name === "bilan-semaine"
      );

      if (!channel) return console.log("Salon bilan-semaine introuvable.");

      await channel.send(`📊 **BILAN HEBDOMADAIRE AUTOMATIQUE**

🟢 CA : ${totalCA}
🔴 Dépenses : ${totalDepenses}

💰 Avant taxe : ${benefAvant}
🏛 Taxe (30%) : ${taxe}
🏆 Net : ${benefNet}

📅 Généré automatiquement`);

      console.log("✅ Bilan envoyé.");
    } catch (error) {
      console.error("Erreur bilan automatique :", error);
    }
  }, { timezone: "Europe/Paris" });
});

// =====================================================
// 📋 LISTE VEHICULES
// =====================================================

async function genererListeVehicules() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${VEHICULE_SHEET_NAME}!C2:E200`
  });

  const rows = res.data.values || [];
  let disponibles = [];

  for (let row of rows) {
    const attribueA = row[2]?.toString().trim().toLowerCase();
    if (attribueA === "libre") {
      disponibles.push(`🚗 ${row[0]} — ${row[1]}`);
    }
  }

  if (!disponibles.length) return "❌ Aucun véhicule disponible.";
  return `📋 **Véhicules disponibles :**\n\n${disponibles.join("\n")}`;
}

// =====================================================
// 📩 COMMANDES
// =====================================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ==========================
  // 📊 TEST BILAN
  // ==========================
  if (message.content === "!testbilan") {
    try {
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SHEET_ID,
        ranges: [
          `${BILAN_SHEET_NAME}!F32`,
          `${BILAN_SHEET_NAME}!J32`,
          `${BILAN_SHEET_NAME}!I39`,
          `${BILAN_SHEET_NAME}!I40`,
          `${BILAN_SHEET_NAME}!I41`
        ]
      });

      const v = res.data.valueRanges;

      return message.reply(`📊 **BILAN HEBDOMADAIRE**

🟢 CA : ${v[0].values?.[0]?.[0] || 0}
🔴 Dépenses : ${v[1].values?.[0]?.[0] || 0}
💰 Avant taxe : ${v[2].values?.[0]?.[0] || 0}
🏛 Taxe : ${v[3].values?.[0]?.[0] || 0}
🏆 Net : ${v[4].values?.[0]?.[0] || 0}`);
    } catch {
      return message.reply("❌ Erreur lecture feuille.");
    }
  }

  // ==========================
  // 📌 RECRUTEMENT
  // ==========================
  if (message.content.startsWith("!recrutement")) {
    const lignes = message.content.split("\n");
    if (lignes.length < 3)
      return message.reply("Format:\n!recrutement\nNom\nRôle exact");

    const nom = lignes[1].trim();
    const role = lignes[2].trim();

    if (!ROLES_CONFIG[role]) return message.reply("❌ Rôle invalide.");

    const { start, end } = ROLES_CONFIG[role];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${start}:B${end}`
    });

    const rows = res.data.values || [];
    let ligneLibre = null;

    for (let i = 0; i <= end - start; i++) {
      if (!rows[i] || !rows[i][0]) {
        ligneLibre = start + i;
        break;
      }
    }

    if (!ligneLibre)
      return message.reply("❌ Plus de place disponible.");

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneLibre}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[nom]] }
    });

    return message.reply(`✅ ${nom} recruté en ${role}.`);
  }

  // ==========================
  // 📌 LICENCIEMENT
  // ==========================
  if (message.content.startsWith("!licenciement")) {
    const lignes = message.content.split("\n");
    if (lignes.length < 3)
      return message.reply("Format:\n!licenciement\nNom\nRôle exact");

    const nom = lignes[1].trim();
    const role = lignes[2].trim();

    if (!ROLES_CONFIG[role]) return message.reply("❌ Rôle invalide.");

    const { start, end } = ROLES_CONFIG[role];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${start}:B${end}`
    });

    const rows = res.data.values || [];
    let ligneTrouvee = null;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0]?.toLowerCase() === nom.toLowerCase()) {
        ligneTrouvee = start + i;
        break;
      }
    }

    if (!ligneTrouvee)
      return message.reply("❌ Employé introuvable.");

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneTrouvee}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[""]] }
    });

    return message.reply(`🔴 ${nom} licencié (${role}).`);
  }

  // ==========================
  // 📌 BILAN RH
  // ==========================
  if (message.content === "!bilan") {
    let recap = "📊 **Bilan RH actuel**\n\n";

    for (const role in ROLES_CONFIG) {
      const { start, end } = ROLES_CONFIG[role];

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${RH_SHEET_NAME}!B${start}:B${end}`
      });

      const rows = res.data.values || [];
      const total = rows.filter(r => r[0]).length;

      recap += `👔 ${role} : ${total}\n`;
    }

    return message.reply(recap);
  }

  if (message.content === "!vehicules") {
    const liste = await genererListeVehicules();
    return message.reply(liste);
  }
});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
