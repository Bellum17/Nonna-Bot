const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent, ChannelType, Partials } = require('discord.js');
const { Pool } = require('pg');

// Créer un nouveau client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ]
});

// Configuration PostgreSQL
// Sur Railway, la variable DATABASE_URL est automatiquement fournie
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Stocker les canaux de logs pour chaque serveur (cache en mémoire)
const logChannels = {
  messages: new Map(),
  voice: new Map()
};

// Stocker les messages pour détecter qui les a supprimés
const messageCache = new Map();

// Initialiser la base de données
async function initDatabase() {
  try {
    // Créer la table si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id VARCHAR(255) PRIMARY KEY,
        log_channel_messages VARCHAR(255),
        log_channel_voice VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Base de données initialisée');
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
  }
}

// Charger la configuration depuis PostgreSQL
async function loadConfig() {
  try {
    const result = await pool.query('SELECT * FROM guild_config');
    
    result.rows.forEach(row => {
      if (row.log_channel_messages) {
        logChannels.messages.set(row.guild_id, row.log_channel_messages);
      }
      if (row.log_channel_voice) {
        logChannels.voice.set(row.guild_id, row.log_channel_voice);
      }
    });
    
    console.log('✅ Configuration chargée depuis PostgreSQL');
    console.log(`📝 Serveurs avec logs messages: ${logChannels.messages.size}`);
    console.log(`🎤 Serveurs avec logs vocaux: ${logChannels.voice.size}`);
  } catch (error) {
    console.error('❌ Erreur lors du chargement de la configuration:', error);
  }
}

// Sauvegarder la configuration dans PostgreSQL
async function saveConfig(guildId, type, channelId) {
  try {
    // Vérifier si la guild existe déjà
    const checkResult = await pool.query(
      'SELECT * FROM guild_config WHERE guild_id = $1',
      [guildId]
    );
    
    if (checkResult.rows.length > 0) {
      // Mettre à jour
      if (type === 'messages') {
        await pool.query(
          'UPDATE guild_config SET log_channel_messages = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
          [channelId, guildId]
        );
      } else if (type === 'voice') {
        await pool.query(
          'UPDATE guild_config SET log_channel_voice = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
          [channelId, guildId]
        );
      }
    } else {
      // Créer une nouvelle entrée
      if (type === 'messages') {
        await pool.query(
          'INSERT INTO guild_config (guild_id, log_channel_messages) VALUES ($1, $2)',
          [guildId, channelId]
        );
      } else if (type === 'voice') {
        await pool.query(
          'INSERT INTO guild_config (guild_id, log_channel_voice) VALUES ($1, $2)',
          [guildId, channelId]
        );
      }
    }
    
    console.log(`✅ Configuration sauvegardée dans PostgreSQL (${type})`);
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde de la configuration:', error);
  }
}

// Événement quand le bot est prêt
client.once('clientReady', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  // Initialiser la base de données et charger la configuration
  await initDatabase();
  await loadConfig();
  
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
      .addSubcommand(subcommand =>
        subcommand
          .setName('vocal')
          .setDescription('Configure les logs des activités vocales')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs vocaux')
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
    const subcommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel');
    
    if (subcommand === 'messages') {
      // Sauvegarder le canal de logs messages pour ce serveur
      logChannels.messages.set(interaction.guildId, channel.id);
      
      // Sauvegarder dans PostgreSQL
      await saveConfig(interaction.guildId, 'messages', channel.id);
      
      await interaction.reply({
        content: `✅ Les logs de messages seront envoyés dans ${channel}\n💾 Configuration sauvegardée dans la base de données!`,
        ephemeral: true
      });
    }
    
    if (subcommand === 'vocal') {
      // Sauvegarder le canal de logs vocaux pour ce serveur
      logChannels.voice.set(interaction.guildId, channel.id);
      
      // Sauvegarder dans PostgreSQL
      await saveConfig(interaction.guildId, 'voice', channel.id);
      
      await interaction.reply({
        content: `✅ Les logs vocaux seront envoyés dans ${channel}\n💾 Configuration sauvegardée dans la base de données!`,
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
  
  const logChannelId = logChannels.messages.get(message.guild.id);
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

  const logChannelId = logChannels.messages.get(newMessage.guild.id);
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

// Logger les activités vocales
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.guild) return;
  
  const logChannelId = logChannels.voice.get(newState.guild.id);
  if (!logChannelId) return;
  
  const logChannel = newState.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  const member = newState.member;
  
  // Rejoindre un salon vocal
  if (!oldState.channel && newState.channel) {
    const embed = new EmbedBuilder()
      .setTitle('🎤 Utilisateur a rejoint un salon vocal')
      .setColor('#00FF00')
      .addFields(
        { name: '👤 Utilisateur', value: `${member.user} (${member.user.id})`, inline: true },
        { name: '🔊 Salon', value: `${newState.channel}`, inline: true },
        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
  }
  
  // Quitter un salon vocal
  else if (oldState.channel && !newState.channel) {
    const embed = new EmbedBuilder()
      .setTitle('🔇 Utilisateur a quitté un salon vocal')
      .setColor('#FF0000')
      .addFields(
        { name: '👤 Utilisateur', value: `${member.user} (${member.user.id})`, inline: true },
        { name: '🔊 Salon', value: `${oldState.channel}`, inline: true },
        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
  }
  
  // Changer de salon vocal
  else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    const embed = new EmbedBuilder()
      .setTitle('🔄 Utilisateur a changé de salon vocal')
      .setColor('#FFA500')
      .addFields(
        { name: '👤 Utilisateur', value: `${member.user} (${member.user.id})`, inline: false },
        { name: '🔊 Ancien salon', value: `${oldState.channel}`, inline: true },
        { name: '🔊 Nouveau salon', value: `${newState.channel}`, inline: true },
        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
  }
  
  // Changements d'état (mute, deafen, stream, vidéo)
  else if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
    const changes = [];
    
    // Mute/Unmute
    if (oldState.selfMute !== newState.selfMute) {
      changes.push(`${newState.selfMute ? '🔇 S\'est mis en muet' : '🔊 A activé son micro'}`);
    }
    if (oldState.serverMute !== newState.serverMute) {
      changes.push(`${newState.serverMute ? '🔇 A été mis en muet par le serveur' : '🔊 N\'est plus muet par le serveur'}`);
    }
    
    // Deafen/Undeafen
    if (oldState.selfDeaf !== newState.selfDeaf) {
      changes.push(`${newState.selfDeaf ? '🔇 S\'est sourdine' : '🔊 A activé son audio'}`);
    }
    if (oldState.serverDeaf !== newState.serverDeaf) {
      changes.push(`${newState.serverDeaf ? '🔇 A été sourdine par le serveur' : '🔊 N\'est plus sourdine par le serveur'}`);
    }
    
    // Stream
    if (oldState.streaming !== newState.streaming) {
      changes.push(`${newState.streaming ? '📡 A commencé à streamer' : '📡 A arrêté de streamer'}`);
    }
    
    // Vidéo
    if (oldState.selfVideo !== newState.selfVideo) {
      changes.push(`${newState.selfVideo ? '📹 A activé sa caméra' : '📹 A désactivé sa caméra'}`);
    }
    
    if (changes.length > 0) {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Changement d\'état vocal')
        .setColor('#00BFFF')
        .addFields(
          { name: '👤 Utilisateur', value: `${member.user} (${member.user.id})`, inline: true },
          { name: '🔊 Salon', value: `${newState.channel}`, inline: true },
          { name: '🔄 Changements', value: changes.join('\n'), inline: false },
          { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
      
      await logChannel.send({ embeds: [embed] });
    }
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
