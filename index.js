const {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

const cron = require("node-cron");
const { google } = require("googleapis");

const vehiculePages = new Map();

// =====================================================
// 🔧 CONFIG
// =====================================================

const SHEET_ID = process.env.SHEET_ID;
const BILAN_SHEET_NAME = "Récapitulatif Hebdo";
const VEHICULE_SHEET_NAME = "Véhicules";

// =====================================================
// 🤖 CLIENT
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
// 📅 READY + BILAN AUTO
// =====================================================

client.once("ready", async () => {
  console.log(`🤖 Connecté : ${client.user.tag}`);

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

      await channel.send(`📊 **BILAN HEBDOMADAIRE**

🟢 CA : ${v[0].values?.[0]?.[0] || 0}
🔴 Dépenses : ${v[1].values?.[0]?.[0] || 0}
💰 Avant taxe : ${v[2].values?.[0]?.[0] || 0}
🏛 Taxe : ${v[3].values?.[0]?.[0] || 0}
🏆 Net : ${v[4].values?.[0]?.[0] || 0}`);

    } catch (err) {
      console.error("Erreur bilan auto :", err);
    }
  }, { timezone: "Europe/Paris" });
});

// =====================================================
// 📋 MESSAGE CREATE (COMMANDES)
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
  if (message.content.toLowerCase().startsWith("!vehicule")) {

    const lignes = message.content.split("\n").map(l => l.trim()).filter(Boolean);

    if (lignes.length < 4)
      return message.reply("Format:\n!vehicule\nNomVehicule\nPlaque\nPseudo");

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
      if (
        rows[i]?.[0]?.toLowerCase() === vehicule.toLowerCase() &&
        rows[i]?.[1]?.toLowerCase() === plaque.toLowerCase() &&
        rows[i]?.[2]?.toLowerCase() === "libre"
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

    return message.reply({
      content: `🚗 Véhicule attribué à ${pseudo}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
  }

  // ==========================
  // 📋 LISTE LIBRES SIMPLE
  // ==========================
  if (message.content === "!vehicules") {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET_NAME}!C2:E200`
    });

    const rows = res.data.values || [];
    const libres = rows.filter(r => r[2]?.toLowerCase() === "libre");

    if (!libres.length)
      return message.reply("❌ Aucun véhicule libre.");

    return message.reply(
      "📋 **Véhicules libres :**\n\n" +
      libres.map(r => `🚗 ${r[0]} — ${r[1]}`).join("\n")
    );
  }
});

// =====================================================
// 🔘 INTERACTION (LIBERER)
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

    return interaction.update({
      content: "🔓 Véhicule libéré.",
      components: []
    });
  }
});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
