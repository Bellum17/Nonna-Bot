const { Client, GatewayIntentBits } = require('discord.js');

// Créer un nouveau client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Événement quand le bot est prêt
client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

// Événement pour répondre aux messages
client.on('messageCreate', (message) => {
  // Ignorer les messages du bot lui-même
  if (message.author.bot) return;

  // Répondre à "!ping"
  if (message.content === '!ping') {
    message.reply('Pong! 🏓');
  }

  // Répondre à "!bonjour"
  if (message.content === '!bonjour') {
    message.reply(`Bonjour ${message.author.username}! 👋`);
  }

  // Répondre à "!aide"
  if (message.content === '!aide') {
    message.reply('Commandes disponibles:\n- !ping\n- !bonjour\n- !aide');
  }
});

// Connexion du bot avec votre token
// Utilise la variable d'environnement DISCORD_TOKEN
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ ERREUR: Le token Discord n\'est pas défini dans les variables d\'environnement');
  process.exit(1);
}

client.login(token);
