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

// =====================================================
// 🔧 CONFIGURATION
// =====================================================

const VEHICULES_SHEET_NAME = "Véhicules";
const RH_SHEET_NAME = "Comptabilité Général";
const BILAN_SHEET_NAME = "Récapitulatif Hebdo";

const RH_CHANNEL_NAME = "recrutement";
const VEHICULE_CHANNEL_NAME = "véhicules";

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.once("clientReady", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

// =====================================================
// 📊 GOOGLE AUTH
// =====================================================

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
});

const sheets = google.sheets({ version: "v4", auth });

// =====================================================
// 📊 FONCTION GENERATION BILAN
// =====================================================

async function genererBilan() {
  try {
    const getCell = async (cell) => {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${BILAN_SHEET_NAME}!${cell}`
      });
      return Number(res.data.values?.[0]?.[0] ?? 0);
    };

    const ca =
      (await getCell("F23")) +
      (await getCell("F24")) +
      (await getCell("F25"));

    let dep = 0;
    for (let i = 23; i <= 30; i++) {
      dep += await getCell(`J${i}`);
    }

    const benef = await getCell("I41");

    return (
      `🍕 **Bilan Hebdomadaire**\n\n` +
      `🟢 CA : ${ca}$\n` +
      `🔴 Dépenses : ${dep}$\n` +
      `💰 Bénéfice : ${benef}$`
    );
  } catch (err) {
    console.error("Erreur génération bilan:", err);
    return null;
  }
}

// =====================================================
// 🚗 VEHICULES
// =====================================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ================= TEST BILAN =================
  if (message.content === "!testbilan") {
    const channel = await client.channels.fetch(
      process.env.DISCORD_BILAN_CHANNEL_ID
    );
    if (!channel) return message.reply("❌ Salon bilan introuvable");

    const bilan = await genererBilan();
    if (!bilan) return message.reply("❌ Erreur génération bilan");

    await channel.send(bilan);
    return message.reply("🧪 Bilan envoyé manuellement");
  }

  // ================= VEHICULE =================
  if (
    message.channel.name === VEHICULE_CHANNEL_NAME &&
    message.content.startsWith("!vehicule")
  ) {
    const contenu = message.content.replace("!vehicule", "").trim();
    const [vehicule, plaque, prenomBrut] = contenu
      .split("|")
      .map((v) => v?.trim());

    if (!vehicule || !plaque) return message.react("❌");

    const prenom = prenomBrut || message.author.username;

    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULES_SHEET_NAME}!D:E`
      });

      const rows = res.data.values || [];

      const index = rows.findIndex(
        (r) => r[0]?.toUpperCase() === plaque.toUpperCase()
      );

      if (index === -1) return message.reply("❌ Plaque introuvable");

      const ligne = index + 1;
      const conducteur = rows[index][1] || "Libre";

      if (conducteur.toLowerCase() !== "libre")
        return message.reply(`🚫 Déjà attribué à ${conducteur}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULES_SHEET_NAME}!E${ligne}`,
        valueInputOption: "RAW",
        requestBody: { values: [[prenom]] }
      });

      message.react("✅");
    } catch (err) {
      console.error("Erreur véhicule:", err);
      message.react("❌");
    }
  }

  // ================= RECRUTEMENT =================
  if (
    message.channel.name === RH_CHANNEL_NAME &&
    message.content.startsWith("!recruter")
  ) {
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

    return message.reply({
      content: `📝 Recrutement:\n${pseudo}\n${nom}\n${fonction}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
  }

  // ================= LICENCIEMENT =================
  if (
    message.channel.name === RH_CHANNEL_NAME &&
    message.content.startsWith("!licencier")
  ) {
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

    return message.reply({
      content: `⚠️ Licenciement:\n${pseudo}\n${fonction}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
  }
});

// =====================================================
// 🔘 INTERACTIONS RH
// =====================================================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const data = interaction.customId.split("|");

  // ===== RECRUTEMENT =====
  if (data[0] === "recrutement") {
    const [_, pseudo, nom, fonction] = data;
    const { start, end } = ROLES_CONFIG[fonction];

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
      return interaction.reply({
        content: "❌ Plus de place disponible",
        ephemeral: true
      });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneLibre}:E${ligneLibre}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pseudo, "", "", nom]] }
    });

    await interaction.update({
      content: `✅ ${nom} recruté en ${fonction}`,
      components: []
    });
  }

  // ===== LICENCIEMENT =====
  if (data[0] === "licenciement") {
    const [_, pseudo, fonction] = data;
    const { start, end } = ROLES_CONFIG[fonction];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${start}:B${end}`
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => r && r[0] === pseudo);

    if (index === -1)
      return interaction.reply({
        content: "❌ Employé introuvable",
        ephemeral: true
      });

    const ligne = start + index;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
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

// =====================================================
// 📊 BILAN AUTO DIMANCHE 23H55
// =====================================================

cron.schedule(
  "55 23 * * 0",
  async () => {
    try {
      const channel = await client.channels.fetch(
        process.env.DISCORD_BILAN_CHANNEL_ID
      );
      if (!channel) return;

      const bilan = await genererBilan();
      if (!bilan) return;

      await channel.send(bilan);
      console.log("📊 Bilan automatique envoyé");
    } catch (err) {
      console.error("Erreur bilan auto:", err);
    }
  },
  { timezone: "Europe/Paris" }
);

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
