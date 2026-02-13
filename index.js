const {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require("discord.js");

const { google } = require("googleapis");

// =====================================================
// 🔧 CONFIGURATION
// =====================================================

const RH_SHEET_NAME = "Comptabilité Général";
const BILAN_SHEET_NAME = "Récapitulatif Hebdo";
const RH_CHANNEL_NAME = "recrutement";
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

client.once("ready", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
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
// 📋 LISTE VEHICULES DISPONIBLES
// =====================================================

async function genererListeVehicules() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${VEHICULE_SHEET_NAME}!C2:E200`
  });

  const rows = res.data.values || [];
  let disponibles = [];

  for (let row of rows) {
    const vehicule = row[0];
    const plaque = row[1];
    const attribueA = row[2]?.toString().trim().toLowerCase();

    if (attribueA === "libre") {
      disponibles.push(`🚗 ${vehicule} — ${plaque}`);
    }
  }

  if (disponibles.length === 0)
    return "❌ Aucun véhicule disponible.";

  return `📋 **Véhicules disponibles :**\n\n${disponibles.join("\n")}`;
}

// =====================================================
// 📩 COMMANDES MESSAGE
// =====================================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== LISTE VEHICULES =====
  if (message.content === "!vehicules") {
    const liste = await genererListeVehicules();
    return message.reply(liste);
  }

  // ===== VEHICULE =====
  if (message.content.startsWith("!vehicule")) {
    const lignes = message.content.split("\n");

    if (lignes.length < 4)
      return message.reply(
        "Format:\n!vehicule\nNom du véhicule\nImmatriculation\nNom de la personne"
      );

    const vehicule = lignes[1].trim();
    const plaque = lignes[2].trim();
    const nom = lignes[3].trim();

    return message.reply({
      content: `🚗 **Demande d'attribution véhicule**

**Véhicule :** ${vehicule}
**Immatriculation :** ${plaque}
**Nom :** ${nom}`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`vehicule|${vehicule}|${plaque}|${nom}`)
            .setLabel("✅ Valider")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`annulervehicule|${vehicule}|${plaque}`)
            .setLabel("❌ Annuler")
            .setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }
});

// =====================================================
// 🔘 INTERACTIONS
// =====================================================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const data = interaction.customId.split("|");

    // ==========================
    // ✅ ATTRIBUTION VEHICULE
    // ==========================
    if (data[0] === "vehicule") {
      const [_, vehicule, plaque, nom] = data;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULE_SHEET_NAME}!C2:E200`
      });

      const rows = res.data.values || [];
      let ligneTrouvee = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const vehiculeSheet = row[0]?.toString().trim().toLowerCase();
        const plaqueSheet = row[1]?.toString().trim().toLowerCase();
        const attribueA = row[2]?.toString().trim().toLowerCase();

        if (
          vehiculeSheet === vehicule.toLowerCase() &&
          plaqueSheet === plaque.toLowerCase() &&
          attribueA === "libre"
        ) {
          ligneTrouvee = i + 2;
          break;
        }
      }

      if (!ligneTrouvee)
        return interaction.reply({
          content: "❌ Véhicule introuvable ou déjà attribué.",
          ephemeral: true
        });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULE_SHEET_NAME}!E${ligneTrouvee}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[nom]] }
      });

      return interaction.update({
        content: `✅ Véhicule attribué !

🚗 ${vehicule}
🪪 ${plaque}
👤 ${nom}`,
        components: []
      });
    }

    // ==========================
    // ❌ ANNULATION VEHICULE
    // ==========================
    if (data[0] === "annulervehicule") {
      const [_, vehicule, plaque] = data;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULE_SHEET_NAME}!C2:E200`
      });

      const rows = res.data.values || [];
      let ligneTrouvee = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const vehiculeSheet = row[0]?.toString().trim().toLowerCase();
        const plaqueSheet = row[1]?.toString().trim().toLowerCase();

        if (
          vehiculeSheet === vehicule.toLowerCase() &&
          plaqueSheet === plaque.toLowerCase()
        ) {
          ligneTrouvee = i + 2;
          break;
        }
      }

      if (!ligneTrouvee)
        return interaction.reply({
          content: "❌ Véhicule introuvable.",
          ephemeral: true
        });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${VEHICULE_SHEET_NAME}!E${ligneTrouvee}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Libre"]] }
      });

      const liste = await genererListeVehicules();

      return interaction.update({
        content: `🔄 Véhicule remis disponible !

${liste}`,
        components: []
      });
    }

  } catch (error) {
    console.error("Erreur interaction :", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Une erreur est survenue.",
        ephemeral: true
      });
    }
  }
});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
