const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent, ChannelType, Partials } = require('discord.js');

// Créer un nouveau client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ]
});

// Stocker les canaux de logs pour chaque serveur
const logChannels = new Map();

// Stocker les messages pour détecter qui les a supprimés
const messageCache = new Map();

// Événement quand le bot est prêt
client.once('clientReady', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  // Enregistrer les commandes slash
  const commands = [
    new SlashCommandBuilder()
      .setName('setup_log')
      .setDescription('Configure le système de logs')
      .addSubcommand(subcommand =>
        subcommand
          .setName('messages')
          .setDescription('Configure les logs de messages supprimés/modifiés')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  try {
    console.log('🔄 Enregistrement des commandes slash...');
    
    // Enregistrer globalement (peut prendre jusqu'à 1h pour se propager)
    await client.application.commands.set(commands);
    
    console.log('✅ Commandes slash enregistrées avec succès!');
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
  }
});

// Gérer les commandes slash
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setup_log') {
    if (interaction.options.getSubcommand() === 'messages') {
      const channel = interaction.options.getChannel('channel');
      
      // Sauvegarder le canal de logs pour ce serveur
      logChannels.set(interaction.guildId, channel.id);
      
      await interaction.reply({
        content: `✅ Les logs de messages seront envoyés dans ${channel}`,
        ephemeral: true
      });
    }
  }
});

// Événement pour répondre aux messages
client.on('messageCreate', (message) => {
  // Ignorer les messages du bot lui-même
  if (message.author.bot) return;

  // Mettre en cache le message pour détecter qui l'a supprimé plus tard
  messageCache.set(message.id, {
    content: message.content,
    author: message.author,
    channel: message.channel,
    attachments: Array.from(message.attachments.values()),
    createdAt: message.createdAt
  });

  // Répondre à "!ping"
  if (message.content === '!ping') {
    message.reply('Pong! 🏓');
  }
});

// Logger les messages supprimés
client.on('messageDelete', async (message) => {
  // Si le message n'est pas dans le cache, essayer de le récupérer partiellement
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      console.log('Impossible de récupérer le message supprimé');
    }
  }

  if (!message.guild) return; // Ignorer les DMs
  
  const logChannelId = logChannels.get(message.guild.id);
  if (!logChannelId) return;

  const logChannel = message.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;

  // Récupérer les infos du message depuis le cache
  const cachedMessage = messageCache.get(message.id) || {
    content: message.content || 'Contenu non disponible',
    author: message.author || { tag: 'Utilisateur inconnu', id: 'inconnu' },
    channel: message.channel,
    attachments: message.attachments ? Array.from(message.attachments.values()) : [],
    createdAt: message.createdAt || new Date()
  };

  // Si l'auteur n'est pas disponible, ne pas continuer
  if (!cachedMessage.author || cachedMessage.author.id === 'inconnu') {
    console.log('Auteur du message supprimé non trouvé');
    return;
  }

  // Vérifier qui a supprimé le message via les logs d'audit
  let deletedBy = null;
  try {
    const auditLogs = await message.guild.fetchAuditLogs({
      type: AuditLogEvent.MessageDelete,
      limit: 1
    });

    const deleteLog = auditLogs.entries.first();
    if (deleteLog && deleteLog.extra.channel.id === message.channel.id &&
        deleteLog.target.id === cachedMessage.author.id &&
        deleteLog.createdTimestamp > Date.now() - 5000) {
      deletedBy = deleteLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor('#FF0000')
    .addFields(
      { name: '👤 Auteur', value: `${cachedMessage.author} (${cachedMessage.author.id})`, inline: true },
      { name: '📝 Canal', value: `${cachedMessage.channel}`, inline: true },
      { name: '📅 Date de création', value: `<t:${Math.floor(cachedMessage.createdAt.getTime() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();

  // Ajouter le contenu du message si disponible
  if (cachedMessage.content) {
    embed.addFields({ name: '💬 Contenu', value: cachedMessage.content.substring(0, 1024) || 'Aucun contenu texte' });
  }

  // Indiquer qui a supprimé le message
  if (deletedBy && deletedBy.id !== cachedMessage.author.id) {
    embed.addFields({ name: '⚠️ Supprimé par', value: `${deletedBy} (${deletedBy.id})` });
    embed.setColor('#FF6600');
  } else {
    embed.addFields({ name: 'ℹ️ Suppression', value: 'Message supprimé par son auteur' });
  }

  // Ajouter les pièces jointes (images/vidéos)
  if (cachedMessage.attachments.length > 0) {
    const attachmentList = cachedMessage.attachments.map(att => 
      `[${att.name}](${att.url}) (${att.contentType || 'Type inconnu'})`
    ).join('\n');
    embed.addFields({ name: '📎 Pièces jointes', value: attachmentList.substring(0, 1024) });
    
    // Ajouter la première image comme thumbnail si disponible
    const firstImage = cachedMessage.attachments.find(att => att.contentType?.startsWith('image/'));
    if (firstImage) {
      embed.setThumbnail(firstImage.url);
    }
  }

  await logChannel.send({ embeds: [embed] });

  // Nettoyer le cache
  messageCache.delete(message.id);
});

// Logger les messages modifiés
client.on('messageUpdate', async (oldMessage, newMessage) => {
  // Ignorer les messages du bot et les messages sans changement de contenu
  if (newMessage.author.bot) return;
  if (oldMessage.content === newMessage.content) return;

  const logChannelId = logChannels.get(newMessage.guild.id);
  if (!logChannelId) return;

  const logChannel = newMessage.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .setColor('#FFA500')
    .addFields(
      { name: '👤 Auteur', value: `${newMessage.author} (${newMessage.author.id})`, inline: true },
      { name: '📝 Canal', value: `${newMessage.channel}`, inline: true },
      { name: '🔗 Lien', value: `[Aller au message](${newMessage.url})`, inline: true },
      { name: '📜 Ancien contenu', value: oldMessage.content?.substring(0, 1024) || 'Aucun contenu' },
      { name: '📝 Nouveau contenu', value: newMessage.content?.substring(0, 1024) || 'Aucun contenu' }
    )
    .setTimestamp();

  // Ajouter les pièces jointes si présentes
  if (newMessage.attachments.size > 0) {
    const attachmentList = Array.from(newMessage.attachments.values())
      .map(att => `[${att.name}](${att.url})`)
      .join('\n');
    embed.addFields({ name: '📎 Pièces jointes', value: attachmentList.substring(0, 1024) });
  }

  await logChannel.send({ embeds: [embed] });
});

// Connexion du bot avec votre token
// Utilise la variable d'environnement DISCORD_TOKEN
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ ERREUR: Le token Discord n\'est pas défini dans les variables d\'environnement');
  process.exit(1);
}

client.login(token);
