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

// ===== Bot ready =====
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// ===== Message handler =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== "véhicules") return;
  if (!message.content.startsWith("!vehicule")) return;

  // Exemple attendu :
  // !vehicule Sultan | AA-123-AA | ❌
  const contenu = message.content.replace("!vehicule", "").trim();
  const [vehicule, plaque, commentaireBrut] = contenu
    .split("|")
    .map(v => v?.trim());

  // Sécurité format
  if (!vehicule || !plaque) {
    return message.react("❌");
  }

  // ===== Gestion croix → Libre (colonne E) =====
  let commentaire = commentaireBrut || "Libre";
  const v = commentaire.toLowerCase();

  if (v === "❌" || v === "x" || v === "croix") {
    commentaire = "Libre";
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Véhicules!A:E",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          new Date().toLocaleString(), // A - Date
          message.author.username,     // B - Utilisateur
          vehicule,                    // C - Véhicule
          plaque,                      // D - Plaque
          commentaire                  // E - Prénom / Libre
        ]]
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
