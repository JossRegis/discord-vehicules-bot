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

// ================= VERIFICATIONS =================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant");
  process.exit(1);
}

if (!process.env.GOOGLE_CREDENTIALS) {
  console.error("❌ GOOGLE_CREDENTIALS manquant");
  process.exit(1);
}

// ================= GOOGLE AUTH =================

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  credentials,
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

  // ================= ATTRIBUER VEHICULE =================
  if (message.content.startsWith("!vehicule")) {

    const lignes = message.content.split("\n").map(l => l.trim()).filter(Boolean);

    if (lignes.length < 4)
      return message.reply("Format:\n!vehicule\nNom du véhicule\nImmatriculation\nNom de la personne");

    const vehicule = lignes[1];
    const plaque = lignes[2];
    const nom = lignes[3];

    const bouton = new ButtonBuilder()
      .setCustomId(`attribuer|${vehicule}|${plaque}|${nom}`)
      .setLabel("Valider l'attribution")
      .setStyle(ButtonStyle.Success);

    return message.reply({
      content: `🚗 **Demande d'attribution**

Véhicule : ${vehicule}
Immatriculation : ${plaque}
Attribué à : ${nom}`,
      components: [new ActionRowBuilder().addComponents(bouton)]
    });
  }

  // ================= LISTE VEHICULES =================
  if (message.content === "!listevehicules") {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET}!C2:E300`
    });

    const rows = res.data.values || [];
    const libres = [];
    const attribues = [];

    rows.forEach((row, index) => {

      const vehicule = row[0];
      const plaque = row[1];
      const attribueA = row[2];
      const ligne = index + 2;

      if (attribueA === "Libre") {
        libres.push(`🚗 ${vehicule} (${plaque})`);
      } else if (attribueA && attribueA !== "Libre") {
        attribues.push({
          texte: `🔒 ${vehicule} (${plaque}) → ${attribueA}`,
          ligne
        });
      }
    });

    let msg = "**🚗 Véhicules Libres :**\n";
    msg += libres.length ? libres.join("\n") : "Aucun";

    msg += "\n\n**🔒 Véhicules Attribués :**\n";
    msg += attribues.length ? attribues.map(v => v.texte).join("\n") : "Aucun";

    const rowButtons = new ActionRowBuilder();

    attribues.slice(0, 5).forEach(v => {
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
  
// ===== LIBERER VEHICULE =====
if (message.content.startsWith("!liberer")) {
  const lignes = message.content.split("\n");

  if (lignes.length < 3) {
    return message.reply("❌ Format incorrect.\n\nUtilise :\n!liberer\nNom du véhicule\nImmatriculation");
  }

  const vehicule = lignes[1].trim();
  const plaque = lignes[2].trim();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Véhicules!C2:E100`
  });

  const rows = res.data.values || [];
  let ligneTrouvee = null;

  for (let i = 0; i < rows.length; i++) {
    const nomVehicule = rows[i][0];
    const immatriculation = rows[i][1];

    if (nomVehicule === vehicule && immatriculation === plaque) {
      ligneTrouvee = i + 2;
      break;
    }
  }

  if (!ligneTrouvee) {
    return message.reply("❌ Véhicule introuvable.");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Véhicules!E${ligneTrouvee}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["Libre"]]
    }
  });

  message.reply(`🚗 Véhicule libéré : ${vehicule} (${plaque})`);
}

  // ================= TEST BILAN =================
  if (message.content === "!testbilan") {
    await envoyerBilan(message.channel);
  }

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async (interaction) => {

  if (!interaction.isButton()) return;

  // ===== ATTRIBUER =====
  if (interaction.customId.startsWith("attribuer|")) {

    const [_, vehicule, plaque, nom] = interaction.customId.split("|");

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET}!C2:E300`
    });

    const rows = res.data.values || [];
    let ligneTrouvee = null;

    for (let i = 0; i < rows.length; i++) {

      const vehiculeSheet = rows[i][0];
      const plaqueSheet = rows[i][1];
      const attribueA = rows[i][2];

      if (
        vehiculeSheet === vehicule &&
        plaqueSheet === plaque &&
        attribueA === "Libre"
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
      range: `${VEHICULE_SHEET}!E${ligneTrouvee}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[nom]]
      }
    });

    return interaction.update({
      content: `✅ Véhicule attribué

🚗 ${vehicule}
🪪 ${plaque}
👤 ${nom}`,
      components: []
    });
  }

  // ===== LIBERER =====
  if (interaction.customId.startsWith("liberer_")) {

    const ligne = interaction.customId.split("_")[1];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${VEHICULE_SHEET}!E${ligne}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Libre"]]
      }
    });

    return interaction.reply({
      content: "🚗 Véhicule libéré.",
      ephemeral: true
    });
  }
});

// ================= FONCTION BILAN =================

async function envoyerBilan(channel) {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${BILAN_SHEET}!F32:J41`
  });

  const values = res.data.values;

  if (!values)
    return channel.send("❌ Impossible de récupérer le bilan.");

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

cron.schedule("55 22 * * 0", async () => {

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
