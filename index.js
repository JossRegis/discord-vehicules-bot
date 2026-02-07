const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { google } = require("googleapis");
const cron = require("node-cron");

// =====================
// Discord client
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
// Google auth
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
// Véhicules Sheet
// =====================
const VEHICULES_SHEET_ID = process.env.SHEET_ID;
const VEHICULES_SHEET_NAME = "Véhicules";

// =====================
// Bot ready
// =====================
client.once("ready", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

// =====================================================
// 📩 COMMANDE !vehicule → AJOUT dans Google Sheets
// =====================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== "véhicules") return;
  if (!message.content.startsWith("!vehicule")) return;

  const contenu = message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque, prenomBrut] = contenu
    .split("|")
    .map(v => v?.trim());

  if (!vehicule || !plaque) return message.react("❌");

  const prenom = prenomBrut || "Libre";

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: VEHICULES_SHEET_ID,
      range: `${VEHICULES_SHEET_NAME}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          new Date().toLocaleString(),
          message.author.username,
          vehicule,
          plaque,
          prenom
        ]]
      }
    });

    message.react("✅");
  } catch (err) {
    console.error("Erreur Sheets (append) :", err);
    message.react("❌");
  }
});

// =====================================================
// ❌ RÉACTION → LIBÉRATION DU VÉHICULE
// =====================================================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  if (reaction.message.channel.name !== "véhicules") return;
  if (!["❌", "X"].includes(reaction.emoji.name)) return;

  const contenu = reaction.message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque] = contenu.split("|").map(v => v.trim());

  try {
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

    await reaction.message.channel.send(
      `${vehicule} | ${plaque} | Libre`
    );

  } catch (err) {
    console.error("Erreur Sheets (update) :", err);
  }
});

// =====================
// Bot Discord - Bilan
// =====================
const bilanClient = new Client({
  intents: [GatewayIntentBits.Guilds]
});

bilanClient.once("ready", () => {
  console.log(`📊 Bot Bilan connecté : ${bilanClient.user.tag}`);
});

// =====================================================
// 🍕 CRON – BILAN FINANCIER AVEC COMPARAISON
// Dimanche 23h59 – Europe/Paris
// =====================================================
cron.schedule(
  "* * * * *", // MODE TEST
  async () => {
    try {
      console.log("📊 Génération du bilan financier");

      // 📁 récupérer les 2 derniers fichiers Sheets
      const files = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet'",
        orderBy: "createdTime desc",
        fields: "files(id, name)",
        pageSize: 2
      });

      if (!files.data.files || files.data.files.length < 2) {
        console.log("❌ Pas assez de fichiers Sheets");
        return;
      }

      const current = files.data.files[0];
      const previous = files.data.files[1];

      const getCell = async (sheetId, cell) => {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `Récapitulatif Hebdo!${cell}`
        });
        return Number(res.data.values?.[0]?.[0] ?? 0);
      };

      // 🟢 Chiffre d'affaires
      const caCurrent =
        (await getCell(current.id, "F23")) +
        (await getCell(current.id, "F24")) +
        (await getCell(current.id, "F25"));

      const caPrevious =
        (await getCell(previous.id, "F23")) +
        (await getCell(previous.id, "F24")) +
        (await getCell(previous.id, "F25"));

      // 🔴 Dépenses
      let depCurrent = 0;
      let depPrevious = 0;

      for (let i = 23; i <= 30; i++) {
        depCurrent += await getCell(current.id, `J${i}`);
        depPrevious += await getCell(previous.id, `J${i}`);
      }

      // 💰 Bénéfice net
      const benefCurrent = await getCell(current.id, "I41");
      const benefPrevious = await getCell(previous.id, "I41");

      const diff = (a, b) => a - b;
      const arrow = v => (v >= 0 ? "📈" : "📉");

      const channel = await bilanClient.channels.fetch("1469508002468856030");
      if (!channel) return;

      const message =
        "🍕 **Bilan financier hebdomadaire — Pizzeria LS**\n\n" +
        `📅 ${current.name}\n\n` +

        "🟢 **Chiffre d’affaires**\n" +
        `• Cette semaine : ${caCurrent}$\n` +
        `• Semaine précédente : ${caPrevious}$\n` +
        `${arrow(diff(caCurrent, caPrevious))} Évolution : ${diff(caCurrent, caPrevious)}$\n\n` +

        "🔴 **Dépenses**\n" +
        `• Cette semaine : ${depCurrent}$\n` +
        `• Semaine précédente : ${depPrevious}$\n` +
        `${arrow(diff(depCurrent, depPrevious))} Évolution : ${diff(depCurrent, depPrevious)}$\n\n` +

        "💰 **Bénéfice net**\n" +
        `• Cette semaine : ${benefCurrent}$\n` +
        `• Semaine précédente : ${benefPrevious}$\n` +
        `${arrow(diff(benefCurrent, benefPrevious))} Évolution : ${diff(benefCurrent, benefPrevious)}$`;

      await channel.send(message);
      console.log("✅ Bilan envoyé");

    } catch (err) {
      console.error("❌ Erreur bilan financier :", err);
    }
  },
  { timezone: "Europe/Paris" }
);

// =====================
// Login
// =====================
client.login(process.env.DISCORD_TOKEN);
bilanClient.login(process.env.DISCORD_BILAN_TOKEN);

// =====================================================
// 🧪 COMMANDE TEST BILAN (manuel)
// =====================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content !== "!testbilan") return;

  await message.reply("🧪 Test bilan déclenché");
});


