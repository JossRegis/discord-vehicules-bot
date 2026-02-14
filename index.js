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
// 📅 READY + CRON
// =====================================================

client.once("ready", async () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);

  cron.schedule("55 23 * * 0", async () => {
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

      const channel = client.channels.cache.find(
        ch => ch.name === "bilan-semaine"
      );

      if (!channel) return;

      await channel.send(`📊 **BILAN HEBDOMADAIRE AUTOMATIQUE**

🟢 CA : ${v[0].values?.[0]?.[0] || 0}
🔴 Dépenses : ${v[1].values?.[0]?.[0] || 0}
💰 Avant taxe : ${v[2].values?.[0]?.[0] || 0}
🏛 Taxe : ${v[3].values?.[0]?.[0] || 0}
🏆 Net : ${v[4].values?.[0]?.[0] || 0}`);

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
    const statut = row[2]?.toString().trim().toLowerCase();
    if (statut === "libre") {
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
  }

  // ==========================
  // 🚗 ATTRIBUER VEHICULE
  // ==========================
  if (message.content.toLowerCase().startsWith("!attribuer")) {

    const lignes = message.content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l !== "");

    if (lignes.length < 4)
      return message.reply(
        "Format:\n!attribuer\nNomVehicule\nPlaque\nPseudoDiscord"
      );

    const vehicule = lignes[1];
    const plaque = lignes[2];
    const pseudo = lignes[3];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET_NAME}!C2:E200`
    });

    const rows = res.data.values || [];
    let ligneTrouvee = null;

    for (let i = 0; i < rows.length; i++) {
      const v = rows[i]?.[0];
      const p = rows[i]?.[1];
      const statut = rows[i]?.[2];

      if (
        v?.toLowerCase() === vehicule.toLowerCase() &&
        p?.toLowerCase() === plaque.toLowerCase() &&
        statut?.toLowerCase() === "libre"
      ) {
        ligneTrouvee = i + 2;
        break;
      }
    }

    if (!ligneTrouvee)
      return message.reply("❌ Véhicule introuvable ou déjà attribué.");

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET_NAME}!E${ligneTrouvee}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[pseudo]] }
    });

    const bouton = new ButtonBuilder()
      .setCustomId(`liberer_${ligneTrouvee}`)
      .setLabel("🔓 Libérer")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(bouton);

    return message.reply({
      content: `🚗 **Véhicule attribué**

Véhicule : ${vehicule}
Plaque : ${plaque}
Attribué à : ${pseudo}`,
      components: [row]
    });
  }

  // ==========================
  // 📋 LISTE VEHICULES
  // ==========================
  if (message.content === "!vehicules") {
    const liste = await genererListeVehicules();
    return message.reply(liste);
  }
});

// =====================================================
// 🔘 BOUTON LIBERER
// =====================================================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("liberer_")) {

    const ligne = interaction.customId.split("_")[1];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET_NAME}!E${ligne}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Libre"]] }
    });

    const liste = await genererListeVehicules();

    return interaction.update({
      content: `🔓 Véhicule libéré avec succès !

${liste}`,
      components: []
    });
  }
});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
