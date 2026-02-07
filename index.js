const { Client, GatewayIntentBits } = require("discord.js");
const { google } = require("googleapis");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== Google Sheets auth =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = "Véhicules";

// ===== Bot ready =====
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// ===== Message handler =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== "véhicules") return;
  if (!message.content.startsWith("!vehicule")) return;

  // !vehicule Sultan | AA-123-AA | ❌
  const contenu = message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque, commentaireBrut] = contenu
    .split("|")
    .map(v => v?.trim());

  if (!plaque) {
    return message.react("❌");
  }

  const v = commentaireBrut?.toLowerCase();
  const doitLiberer = v === "❌" || v === "x" || v === "croix";

  if (!doitLiberer) {
    return message.react("❌"); // ici on ne gère que la libération
  }

  try {
    // 1️⃣ Lire toutes les plaques (colonne D)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!D:D`
    });

    const rows = res.data.values || [];

    // 2️⃣ Trouver la ligne correspondante
    const index = rows.findIndex(
      row => row[0]?.toUpperCase() === plaque.toUpperCase()
    );

    if (index === -1) {
      console.log("Plaque non trouvée :", plaque);
      return message.react("❌");
    }

    const ligne = index + 1; // Google Sheets commence à 1

    // 3️⃣ Mettre à jour la colonne E de cette ligne
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!E${ligne}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Libre"]]
      }
    });

    message.react("✅");
  } catch (err) {
    console.error("Erreur Google Sheets :", err);
    message.react("❌");
  }
});

// ===== Login =====
client.login(process.env.DISCORD_TOKEN);
