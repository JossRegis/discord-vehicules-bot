const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { google } = require("googleapis");
const cron = require("node-cron");

// ================= CONFIG =================

const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;

const BILAN_CHANNEL_NAME = "bilan-semaine";

const RH_SHEET_NAME = "Comptabilité Général";
const VEHICULE_SHEET = "Véhicules";
const BILAN_SHEET = "Récapitulatif Hebdo";

const ROLES_CONFIG = {
  "Pizzaiolo Apprenti": { start: 43, end: 76 },
  "Pizzaiolo Confirmé": { start: 34, end: 42 },
  "Pizzaiolo Vétéran": { start: 26, end: 33 },
  "Vendeur": { start: 17, end: 24 }
};

// ================= VERIFICATION =================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant");
  process.exit(1);
}

// ================= GOOGLE AUTH =================

if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("❌ GOOGLE_CREDENTIALS manquant");
  process.exit(1);
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth
});


// ================= DISCORD CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// ================= COMMANDES =================

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  // ================= RECRUTER =================
  if (message.content.startsWith("!recruter")) {

    const lignes = message.content.split("\n").map(l => l.trim()).filter(Boolean);
    if (lignes.length < 4)
      return message.reply("Format:\n!recruter\nPseudoDiscord\nPrénom Nom\nGrade");

    const pseudo = lignes[1];
    const prenomNom = lignes[2];
    const grade = lignes[3];

    if (!ROLES_CONFIG[grade])
      return message.reply("❌ Grade invalide.");

    const plage = ROLES_CONFIG[grade];

    const check = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!E:E`
    });

    if (check.data.values?.flat().includes(prenomNom))
      return message.reply("❌ Cette personne est déjà enregistrée.");

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${plage.start}:E${plage.end}`
    });

    const rows = res.data.values || [];
    let ligneLibre = null;

    for (let i = 0; i <= (plage.end - plage.start); i++) {
      const row = rows[i] || [];
      if (!row[3]) {
        ligneLibre = plage.start + i;
        break;
      }
    }

    if (!ligneLibre)
      return message.reply("❌ Aucune place disponible.");

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneLibre}:E${ligneLibre}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[pseudo, "", "", prenomNom]]
      }
    });

    return message.reply(`✅ ${prenomNom} recruté en ${grade}`);
  }

  // ================= LICENCIER =================
  if (message.content.startsWith("!licencier")) {

    const lignes = message.content.split("\n").map(l => l.trim()).filter(Boolean);
    if (lignes.length < 2)
      return message.reply("Format:\n!licencier\nPrénom Nom");

    const prenomNom = lignes[1];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!E:E`
    });

    const rows = res.data.values || [];
    let ligneTrouvee = null;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[0] === prenomNom) {
        ligneTrouvee = i + 1;
        break;
      }
    }

    if (!ligneTrouvee)
      return message.reply("❌ Employé introuvable.");

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${RH_SHEET_NAME}!B${ligneTrouvee}:E${ligneTrouvee}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["", "", "", ""]]
      }
    });

    return message.reply(`❌ ${prenomNom} licencié.`);
  }

  // ================= LISTE VEHICULES =================
  if (message.content === "!listevehicules") {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET}!A2:D`
    });

    const rows = res.data.values || [];
    const libres = [];
    const attribues = [];

    rows.forEach((row, index) => {
      const nom = row[0];
      const statut = row[2];
      const utilisateur = row[3];
      const ligne = index + 2;

      if (statut === "Libre")
        libres.push(`🚗 ${nom}`);
      else if (statut === "Attribué")
        attribues.push({ texte: `🔒 ${nom} → ${utilisateur}`, ligne });
    });

    let msg = "**🚗 Véhicules Libres :**\n";
    msg += libres.length ? libres.join("\n") : "Aucun";

    msg += "\n\n**🔒 Véhicules Attribués :**\n";
    msg += attribues.length ? attribues.map(v => v.texte).join("\n") : "Aucun";

    const rowButtons = new ActionRowBuilder();

    attribues.forEach(v => {
      rowButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`liberer_${v.ligne}`)
          .setLabel("Libérer")
          .setStyle(ButtonStyle.Danger)
      );
    });

    await message.channel.send({
      content: msg,
      components: attribues.length ? [rowButtons] : []
    });
  }

  // ================= TEST BILAN =================
  if (message.content === "!testbilan") {
    await envoyerBilan(message.channel);
  }

});

// ================= BOUTON LIBERER =================

client.on("interactionCreate", async (interaction) => {

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("liberer_")) {

    const ligne = interaction.customId.split("_")[1];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET}!C${ligne}:D${ligne}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Libre", ""]]
      }
    });

    await interaction.reply({ content: "🚗 Véhicule libéré.", ephemeral: true });
  }
});

// ================= FONCTION BILAN =================

async function envoyerBilan(channel) {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${BILAN_SHEET}!F32:J41`
  });

  const values = res.data.values;

  if (!values) {
    return channel.send("❌ Impossible de récupérer le bilan.");
  }

  const totalCA = values[0]?.[0] || "0";
  const totalDepense = values[0]?.[4] || "0";
  const benefAvant = values[7]?.[3] || "0";
  const taxe = values[8]?.[3] || "0";
  const benefNet = values[9]?.[3] || "0";

  const message = `
📊 **Bilan Hebdomadaire**

💰 Total CA : ${totalCA}
💸 Total Dépenses : ${totalDepense}

📈 Bénéfice avant taxe : ${benefAvant}
🏛 Taxe (30%) : ${taxe}
💎 Bénéfice Net : ${benefNet}
`;

  await channel.send(message);
}

// ================= CRON DIMANCHE 23H55 =================

cron.schedule("55 23 * * 0", async () => {

  client.guilds.cache.forEach(async guild => {

    const channel = guild.channels.cache.find(
      c => c.name === BILAN_CHANNEL_NAME
    );

    if (channel) {
      await envoyerBilan(channel);
    }
  });

});

client.login(TOKEN);
