const {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require("discord.js");

const { google } = require("googleapis");
const cron = require("node-cron");

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// =====================
// GOOGLE AUTH
// =====================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
});

const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

// =====================
// CONFIG
// =====================
const VEHICULES_SHEET_ID = process.env.SHEET_ID;
const VEHICULES_SHEET_NAME = "Véhicules";

const RH_CHANNEL_NAME = "recrutement";
const RH_SHEET_NAME = "Comptabilité Général";

const ROLES_CONFIG = {
  "Pizzaiolo Apprenti": { start: 43, end: 76 },
  "Pizzaiolo Confirmé": { start: 34, end: 42 },
  "Pizzaiolo Vétéran": { start: 26, end: 33 },
  "Vendeur": { start: 17, end: 24 }
};

// =====================
// READY
// =====================
client.once("ready", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

// =====================================================
// 🚗 COMMANDE !vehicule
// =====================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== "véhicules") return;
  if (!message.content.startsWith("!vehicule")) return;

  const contenu = message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque, prenomBrut] = contenu.split("|").map(v => v?.trim());
  if (!vehicule || !plaque) return message.react("❌");

  const prenom = prenomBrut || message.author.username;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: VEHICULES_SHEET_ID,
      range: `${VEHICULES_SHEET_NAME}!D:E`
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(
      r => r[0]?.toUpperCase() === plaque.toUpperCase()
    );

    if (index === -1)
      return message.reply("❌ Plaque introuvable");

    const ligne = index + 1;
    const conducteurActuel = rows[index][1] || "Libre";

    if (conducteurActuel.toLowerCase() !== "libre")
      return message.reply(
        `🚫 Déjà attribué à ${conducteurActuel}`
      );

    await sheets.spreadsheets.values.update({
      spreadsheetId: VEHICULES_SHEET_ID,
      range: `${VEHICULES_SHEET_NAME}!E${ligne}`,
      valueInputOption: "RAW",
      requestBody: { values: [[prenom]] }
    });

    message.react("✅");

  } catch (err) {
    console.error(err);
    message.react("❌");
  }
});

// =====================================================
// ❌ LIBERATION VEHICULE
// =====================================================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (!["❌", "X"].includes(reaction.emoji.name)) return;
  if (reaction.message.channel.name !== "véhicules") return;

  const contenu = reaction.message.content.replace("!vehicule", "").trim();
  const [, plaque] = contenu.split("|").map(v => v.trim());

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: VEHICULES_SHEET_ID,
    range: `${VEHICULES_SHEET_NAME}!D:D`
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(
    r => r[0]?.toUpperCase() === plaque.toUpperCase()
  );

  if (index === -1) return;

  const ligne = index + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: VEHICULES_SHEET_ID,
    range: `${VEHICULES_SHEET_NAME}!E${ligne}`,
    valueInputOption: "RAW",
    requestBody: { values: [["Libre"]] }
  });

  await reaction.message.delete();
});

// =====================================================
// 👥 RECRUTEMENT
// =====================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== RH_CHANNEL_NAME) return;

  // ===== RECRUTER =====
  if (message.content.startsWith("!recruter")) {
    const lignes = message.content.split("\n");
    if (lignes.length < 4)
      return message.reply(
        "Format:\n!recruter\nPseudoDiscord\nPrénom Nom\nFonction"
      );

    const pseudo = lignes[1].trim();
    const nom = lignes[2].trim();
    const fonction = lignes[3].trim();

    if (!ROLES_CONFIG[fonction])
      return message.reply("❌ Fonction invalide");

    const bouton = new ButtonBuilder()
      .setCustomId(`recrutement|${pseudo}|${nom}|${fonction}`)
      .setLabel("Valider le recrutement")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(bouton);

    return message.reply({
      content:
        `📝 Recrutement :\n${pseudo}\n${nom}\n${fonction}`,
      components: [row]
    });
  }

  // ===== LICENCIER =====
  if (message.content.startsWith("!licencier")) {
    const lignes = message.content.split("\n");
    if (lignes.length < 3)
      return message.reply(
        "Format:\n!licencier\nPseudoDiscord\nFonction"
      );

    const pseudo = lignes[1].trim();
    const fonction = lignes[2].trim();

    if (!ROLES_CONFIG[fonction])
      return message.reply("❌ Fonction invalide");

    const bouton = new ButtonBuilder()
      .setCustomId(`licenciement|${pseudo}|${fonction}`)
      .setLabel("Valider le licenciement")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(bouton);

    return message.reply({
      content:
        `⚠️ Licenciement :\n${pseudo}\n${fonction}`,
      components: [row]
    });
  }
});

// =====================================================
// 🔘 BOUTONS RH
// =====================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const data = interaction.customId.split("|");

  // ===== RECRUTEMENT =====
  if (data[0] === "recrutement") {
    const pseudo = data[1];
    const nom = data[2];
    const fonction = data[3];

    const { start, end } = ROLES_CONFIG[fonction];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${RH_SHEET_NAME}!B${start}:B${end}`
    });

    const rows = res.data.values || [];
    let ligneLibre = null;

    for (let i = 0; i <= (end - start); i++) {
      if (!rows[i] || !rows[i][0]) {
        ligneLibre = start + i;
        break;
      }
    }

    if (!ligneLibre)
      return interaction.reply({ content: "❌ Plus de place", ephemeral: true });

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneLibre}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pseudo]] }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${RH_SHEET_NAME}!E${ligneLibre}`,
      valueInputOption: "RAW",
      requestBody: { values: [[nom]] }
    });

    await interaction.update({
      content: `✅ ${nom} recruté en ${fonction}`,
      components: []
    });
  }

  // ===== LICENCIEMENT =====
  if (data[0] === "licenciement") {
    const pseudo = data[1];
    const fonction = data[2];
    const { start, end } = ROLES_CONFIG[fonction];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${RH_SHEET_NAME}!B${start}:B${end}`
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(r => r && r[0] === pseudo);

    if (index === -1)
      return interaction.reply({ content: "❌ Introuvable", ephemeral: true });

    const ligne = start + index;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligne}:E${ligne}`,
      valueInputOption: "RAW",
      requestBody: { values: [["", "", "", ""]] }
    });

    await interaction.update({
      content: `❌ ${pseudo} licencié (${fonction})`,
      components: []
    });
  }
});

// =====================
// LOGIN
// =====================
client.login(process.env.DISCORD_TOKEN);
