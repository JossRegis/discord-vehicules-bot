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

const RH_SHEET_NAME = "Comptabilité Général";
const BILAN_SHEET_NAME = "Récapitulatif Hebdo";
const RH_CHANNEL_NAME = "recrutement";

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

client.once("clientReady", () => {
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
// 📊 GENERATION BILAN
// =====================================================

async function genererBilan() {
  try {
    const getCell = async (cell) => {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${BILAN_SHEET_NAME}!${cell}`
      });

      let value = res.data.values?.[0]?.[0];
      if (!value) return 0;

      value = value.toString().replace(/\s/g, "").replace(/\$/g, "").replace(",", ".");
      const number = parseFloat(value);
      return isNaN(number) ? 0 : number;
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

    const format = (n) =>
      n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

    return `🍕 **Bilan Hebdomadaire**\n\n🟢 CA : ${format(ca)}$\n🔴 Dépenses : ${format(dep)}$\n💰 Bénéfice : ${format(benef)}$`;
  } catch (err) {
    console.error("Erreur génération bilan:", err);
    return null;
  }
}

// =====================================================
// 📩 COMMANDES MESSAGE
// =====================================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== TEST BILAN =====
  if (message.content === "!testbilan") {
    if (!process.env.DISCORD_BILAN_CHANNEL_ID)
      return message.reply("❌ DISCORD_BILAN_CHANNEL_ID manquant");

    const channel = client.channels.cache.get(
      process.env.DISCORD_BILAN_CHANNEL_ID
    );

    if (!channel)
      return message.reply("❌ Salon bilan introuvable");

    const bilan = await genererBilan();
    if (!bilan)
      return message.reply("❌ Erreur génération bilan");

    await channel.send(bilan);
    return message.reply("🧪 Bilan envoyé");
  }

  // ===== RECRUTEMENT =====
  if (
    message.channel.name === RH_CHANNEL_NAME &&
    message.content.startsWith("!recruter")
  ) {
    const lignes = message.content.split("\n");
    if (lignes.length < 4)
      return message.reply("Format:\n!recruter\nPseudoDiscord\nPrénom Nom\nFonction");

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
      content: `📝 Recrutement en attente :\n\n👤 ${pseudo}\n📛 ${nom}\n💼 ${fonction}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
  }

  // ===== LICENCIEMENT =====
  if (
    message.channel.name === RH_CHANNEL_NAME &&
    message.content.startsWith("!licencier")
  ) {
    const lignes = message.content.split("\n");
    if (lignes.length < 3)
      return message.reply("Format:\n!licencier\nPseudoDiscord\nFonction");

    const pseudo = lignes[1].trim();
    const fonction = lignes[2].trim();

    if (!ROLES_CONFIG[fonction])
      return message.reply("❌ Fonction invalide");

    const bouton = new ButtonBuilder()
      .setCustomId(`licenciement|${pseudo}|${fonction}`)
      .setLabel("Valider le licenciement")
      .setStyle(ButtonStyle.Danger);

    return message.reply({
      content: `⚠️ Licenciement en attente :\n\n👤 ${pseudo}\n💼 ${fonction}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
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

    const bouton = new ButtonBuilder()
      .setCustomId(`vehicule|${vehicule}|${plaque}|${nom}`)
      .setLabel("Valider l'attribution")
      .setStyle(ButtonStyle.Primary);

    return message.reply({
      content: `🚗 **Demande d'attribution véhicule**

**Véhicule :** ${vehicule}
**Immatriculation :** ${plaque}
**Nom de la personne :** ${nom}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
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

    // ===== RECRUTEMENT =====
    if (data[0] === "recrutement") {
      const [_, pseudo, nom, fonction] = data;
      const { start, end } = ROLES_CONFIG[fonction];

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${RH_SHEET_NAME}!E${start}:E${end}`
      });

      const noms = res.data.values || [];
      let ligneLibre = null;

      for (let i = 0; i < (end - start + 1); i++) {
        const rowIndex = start + i;
        const nomCell = noms[i]?.[0];

        if (!nomCell || nomCell.toString().trim() === "") {
          ligneLibre = rowIndex;
          break;
        }
      }

      if (!ligneLibre) {
        return interaction.reply({
          content: "❌ Plus de place disponible pour ce rôle.",
          ephemeral: true
        });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${RH_SHEET_NAME}!B${ligneLibre}:E${ligneLibre}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[pseudo, "", fonction, nom]]
        }
      });

      return interaction.update({
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
      let ligne = null;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === pseudo) {
          ligne = start + i;
          break;
        }
      }

      if (!ligne) {
        return interaction.reply({
          content: "❌ Employé introuvable.",
          ephemeral: true
        });
      }

      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${RH_SHEET_NAME}!B${ligne}:E${ligne}`
      });

      return interaction.update({
        content: `🚨 ${pseudo} licencié (${fonction})`,
        components: []
      });
    }

    // ===== VEHICULE =====  ✅ BON ENDROIT
    if (data[0] === "vehicule") {
      const [_, vehicule, plaque, nom] = data;

      return interaction.update({
        content: `✅ Véhicule attribué

🚗 Véhicule : ${vehicule}
🪪 Immatriculation : ${plaque}
👤 Attribué à : ${nom}`,
        components: []
      });
    }

  } catch (err) {
    console.error("Erreur interaction:", err);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: "❌ Erreur système.",
        ephemeral: true
      });
    }
  }
});

// =====================================================
// 🚀 LOGIN
// =====================================================

client.login(process.env.DISCORD_TOKEN);
