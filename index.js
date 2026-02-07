const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { google } = require("googleapis");

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
// Google Sheets auth
// =====================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = "Véhicules";

// =====================
// Bot ready
// =====================
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// =====================================================
// 📩 COMMANDE !vehicule → AJOUT dans Google Sheets
// =====================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== "véhicules") return;
  if (!message.content.startsWith("!vehicule")) return;

  // Format attendu :
  // !vehicule Sultan | AA-123-AA | Jean
  const contenu = message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque, prenomBrut] = contenu
    .split("|")
    .map(v => v?.trim());

  if (!vehicule || !plaque) {
    return message.react("❌");
  }

  const prenom = prenomBrut || "Libre";

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          new Date().toLocaleString(), // A
          message.author.username,     // B
          vehicule,                    // C
          plaque,                      // D
          prenom                       // E
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
  if (reaction.emoji.name !== "❌" && reaction.emoji.name !== "X") return;

  // Message attendu :
  // !vehicule Sultan | AA-123-AA | Jean
  const contenu = reaction.message.content
    .replace("!vehicule", "")
    .trim();

  const parts = contenu.split("|").map(v => v.trim());
  if (parts.length < 2) return;

  const vehicule = parts[0];
  const plaque = parts[1];

  try {
    // 1️⃣ Lire toutes les plaques (colonne D)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!D:D`
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(
      row => row[0]?.toUpperCase() === plaque.toUpperCase()
    );

    if (index === -1) return;

    const ligne = index + 1;

    // 2️⃣ Mettre le prénom à "Libre" (colonne E)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!E${ligne}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Libre"]]
      }
    });

    // 3️⃣ Message Discord (régénération ICI)
    await reaction.message.channel.send(
      `${vehicule} | ${plaque} | Libre`
    );

  } catch (err) {
    console.error("Erreur Sheets (update) :", err);
  }
});

// =====================
// Login
// =====================
client.login(process.env.DISCORD_TOKEN);
