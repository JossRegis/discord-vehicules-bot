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
const vehiculePages = new Map();

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
// 📋 LISTE VEHICULES ATTRIBUÉS
// ==========================
if (message.content.toLowerCase() === "!listevehicules") {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${VEHICULE_SHEET_NAME}!C2:E200`
  });

  const rows = res.data.values || [];

  const embed = new EmbedBuilder()
    .setTitle("🚗 Véhicules attribués")
    .setColor("Red");

  const components = [];

  for (let i = 0; i < rows.length; i++) {
    const vehicule = rows[i]?.[0];
    const plaque = rows[i]?.[1];
    const statut = rows[i]?.[2];

    if (statut && statut.toLowerCase() !== "libre") {

      embed.addFields({
        name: `${vehicule} | ${plaque}`,
        value: `Attribué à : ${statut}`,
        inline: false
      });

      const bouton = new ButtonBuilder()
        .setCustomId(`liberer_${i + 2}`)
        .setLabel(`🔓 Libérer ${vehicule}`)
        .setStyle(ButtonStyle.Danger);

      components.push(
        new ActionRowBuilder().addComponents(bouton)
      );
    }
  }

  if (embed.data.fields?.length === 0) {
    return message.reply("✅ Aucun véhicule attribué.");
  }

  return message.reply({
    embeds: [embed],
    components: components.slice(0, 5) // Discord limite à 5 rows
  });
}
  // ==========================
// 📋 LISTE COMPLETE VEHICULES
// ==========================
if (message.content.toLowerCase() === "!listevehicules") {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Véhicules!C2:E200`
  });

  const rows = res.data.values || [];

  const embed = new EmbedBuilder()
    .setTitle("🚗 Liste des véhicules")
    .setColor("Blue");

  const components = [];

  let compteurBoutons = 0;

  for (let i = 0; i < rows.length; i++) {

    const vehicule = rows[i]?.[0];
    const plaque = rows[i]?.[1];
    const statut = rows[i]?.[2] || "Libre";

    if (!vehicule) continue;

    if (statut.toLowerCase() === "libre") {

      embed.addFields({
        name: `🟢 ${vehicule} | ${plaque}`,
        value: `Statut : Libre`,
        inline: false
      });

    } else {

      embed.addFields({
        name: `🔴 ${vehicule} | ${plaque}`,
        value: `Attribué à : ${statut}`,
        inline: false
      });

      // Max 5 boutons (limite Discord)
      if (compteurBoutons < 5) {
        const bouton = new ButtonBuilder()
          .setCustomId(`liberer_${i + 2}`)
          .setLabel(`🔓 Libérer ${plaque}`)
          .setStyle(ButtonStyle.Danger);

        components.push(
          new ActionRowBuilder().addComponents(bouton)
        );

        compteurBoutons++;
      }
    }
  }

  return message.reply({
    embeds: [embed],
    components: components
  });
}

  // ==========================
  // 🚗 ATTRIBUER VEHICULE
  // ==========================
  if (message.content.toLowerCase().startsWith("!vehicule")) {

    const lignes = message.content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l !== "");

    if (lignes.length < 4)
      return message.reply(
        "Format:\n!vehicule\nNomVehicule\nPlaque\nPseudoDiscord"
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

    await interaction.update({
      content: "🔓 Véhicule libéré avec succès.",
      embeds: [],
      components: []
    });
  }
  client.on("interactionCreate", async (interaction) => {

  if (!interaction.isButton()) return;

  const data = vehiculePages.get(interaction.user.id);
  if (!data) return;

  // 🔓 LIBERATION
  if (interaction.customId.startsWith("liberer_")) {

    const ligne = interaction.customId.split("_")[1];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Véhicules!E${ligne}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Libre"]] }
    });

    // Recharge les données après modification
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Véhicules!C2:E300`
    });

    const rows = res.data.values || [];

    const libres = [];
    const attribues = [];

    rows.forEach((row, index) => {
      const vehicule = row[0];
      const plaque = row[1];
      const statut = row[2] || "Libre";

      if (!vehicule) return;

      const newData = {
        ligne: index + 2,
        vehicule,
        plaque,
        statut
      };

      if (statut.toLowerCase() === "libre") {
        libres.push(newData);
      } else {
        attribues.push(newData);
      }
    });

    data.libres = libres;
    data.attribues = attribues;

    return envoyerPageVehicules(interaction, interaction.user.id, true);
  }

  // Navigation
  if (interaction.customId === "prev_page") data.page--;
  if (interaction.customId === "next_page") data.page++;
  if (interaction.customId === "switch_type") {
    data.type = data.type === "libres" ? "attribues" : "libres";
    data.page = 0;
  }

  vehiculePages.set(interaction.user.id, data);

  return envoyerPageVehicules(interaction, interaction.user.id, true);
});

  client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  // 🔹 COMMANDE LISTE VEHICULES
  if (message.content.toLowerCase() === "!listevehicules") {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Véhicules!C2:E300`
    });

    const rows = res.data.values || [];

    const libres = [];
    const attribues = [];

    rows.forEach((row, index) => {
      const vehicule = row[0];
      const plaque = row[1];
      const statut = row[2] || "Libre";

      if (!vehicule) return;

      const data = {
        ligne: index + 2,
        vehicule,
        plaque,
        statut
      };

      if (statut.toLowerCase() === "libre") {
        libres.push(data);
      } else {
        attribues.push(data);
      }
    });

    vehiculePages.set(message.author.id, {
      libres,
      attribues,
      page: 0,
      type: "libres"
    });

    return envoyerPageVehicules(message, message.author.id);
  }

});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
