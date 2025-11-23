const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent, ChannelType, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Créer un nouveau client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ]
});

// Stocker les canaux de logs pour chaque serveur
const logChannels = {
  messages: new Map(),
  voice: new Map(),
  roles: new Map(),
  channels: new Map()
};

// Stocker les messages pour détecter qui les a supprimés
const messageCache = new Map();

// Fichier de configuration
const configPath = path.join(__dirname, 'config.json');

// Fonction pour charger la configuration
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      
      // Charger les canaux de logs pour chaque type
      if (config.logChannels?.messages) {
        Object.entries(config.logChannels.messages).forEach(([guildId, channelId]) => {
          logChannels.messages.set(guildId, channelId);
        });
      }
      if (config.logChannels?.voice) {
        Object.entries(config.logChannels.voice).forEach(([guildId, channelId]) => {
          logChannels.voice.set(guildId, channelId);
        });
      }
      if (config.logChannels?.roles) {
        Object.entries(config.logChannels.roles).forEach(([guildId, channelId]) => {
          logChannels.roles.set(guildId, channelId);
        });
      }
      if (config.logChannels?.channels) {
        Object.entries(config.logChannels.channels).forEach(([guildId, channelId]) => {
          logChannels.channels.set(guildId, channelId);
        });
      }
      
      console.log('✅ Configuration chargée avec succès');
      console.log(`📝 Messages: ${logChannels.messages.size} | 🎤 Vocaux: ${logChannels.voice.size} | 🎭 Rôles: ${logChannels.roles.size} | 📁 Salons: ${logChannels.channels.size}`);
    }
  } catch (error) {
    console.error('❌ Erreur lors du chargement de la configuration:', error);
  }
}

// Fonction pour sauvegarder la configuration
function saveConfig() {
  try {
    const config = {
      logChannels: {
        messages: Object.fromEntries(logChannels.messages),
        voice: Object.fromEntries(logChannels.voice),
        roles: Object.fromEntries(logChannels.roles),
        channels: Object.fromEntries(logChannels.channels)
      }
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('✅ Configuration sauvegardée');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde de la configuration:', error);
  }
}

// Événement quand le bot est prêt
client.once('clientReady', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  // Charger la configuration sauvegardée
  loadConfig();
  
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
      .addSubcommand(subcommand =>
        subcommand
          .setName('roles')
          .setDescription('Configure les logs des modifications de rôles')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs de rôles')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('salons')
          .setDescription('Configure les logs des créations/suppressions de salons')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs de salons')
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
      logChannels.messages.set(interaction.guildId, channel.id);
      saveConfig();
      await interaction.reply({
        content: `✅ Les logs de messages seront envoyés dans ${channel}\n💾 Configuration sauvegardée!`,
        ephemeral: true
      });
    }
    
    if (subcommand === 'vocal') {
      logChannels.voice.set(interaction.guildId, channel.id);
      saveConfig();
      await interaction.reply({
        content: `✅ Les logs vocaux seront envoyés dans ${channel}\n💾 Configuration sauvegardée!`,
        ephemeral: true
      });
    }
    
    if (subcommand === 'roles') {
      logChannels.roles.set(interaction.guildId, channel.id);
      saveConfig();
      await interaction.reply({
        content: `✅ Les logs de rôles seront envoyés dans ${channel}\n💾 Configuration sauvegardée!`,
        ephemeral: true
      });
    }
    
    if (subcommand === 'salons') {
      logChannels.channels.set(interaction.guildId, channel.id);
      saveConfig();
      await interaction.reply({
        content: `✅ Les logs de salons seront envoyés dans ${channel}\n💾 Configuration sauvegardée!`,
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
});

// Logger les modifications de rôles
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannelId = logChannels.roles.get(newMember.guild.id);
  if (!logChannelId) return;
  
  const logChannel = newMember.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Vérifier les changements de rôles
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  
  const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
  const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
  
  if (addedRoles.size === 0 && removedRoles.size === 0) return;
  
  // Chercher qui a fait la modification
  let executor = null;
  try {
    const auditLogs = await newMember.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 1
    });
    
    const roleLog = auditLogs.entries.first();
    if (roleLog && roleLog.target.id === newMember.id && 
        roleLog.createdTimestamp > Date.now() - 5000) {
      executor = roleLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎭 Modification de rôles')
    .setColor('#9B59B6')
    .addFields(
      { name: '👤 Membre', value: `${newMember.user} (${newMember.user.id})`, inline: true },
      { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setThumbnail(newMember.user.displayAvatarURL())
    .setTimestamp();
  
  if (addedRoles.size > 0) {
    embed.addFields({ 
      name: '✅ Rôles ajoutés', 
      value: addedRoles.map(role => role.toString()).join(', ') 
    });
  }
  
  if (removedRoles.size > 0) {
    embed.addFields({ 
      name: '❌ Rôles retirés', 
      value: removedRoles.map(role => role.toString()).join(', ') 
    });
  }
  
  if (executor) {
    embed.addFields({ name: '⚙️ Modifié par', value: `${executor} (${executor.id})` });
  }
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la création de salons
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  
  const logChannelId = logChannels.channels.get(channel.guild.id);
  if (!logChannelId) return;
  
  const logChannel = channel.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Chercher qui a créé le salon
  let executor = null;
  try {
    const auditLogs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 1
    });
    
    const createLog = auditLogs.entries.first();
    if (createLog && createLog.target.id === channel.id) {
      executor = createLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const channelTypes = {
    0: '💬 Textuel',
    2: '🔊 Vocal',
    4: '📁 Catégorie',
    5: '📢 Annonces',
    13: '🎙️ Stage',
    15: '🧵 Forum'
  };
  
  const embed = new EmbedBuilder()
    .setTitle('📁 Salon créé')
    .setColor('#00FF00')
    .addFields(
      { name: '📝 Nom', value: channel.name, inline: true },
      { name: '🆔 ID', value: channel.id, inline: true },
      { name: '📋 Type', value: channelTypes[channel.type] || 'Inconnu', inline: true },
      { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
  
  if (executor) {
    embed.addFields({ name: '👤 Créé par', value: `${executor} (${executor.id})` });
  }
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la suppression de salons
client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  
  const logChannelId = logChannels.channels.get(channel.guild.id);
  if (!logChannelId) return;
  
  const logChannel = channel.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Chercher qui a supprimé le salon
  let executor = null;
  try {
    const auditLogs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 1
    });
    
    const deleteLog = auditLogs.entries.first();
    if (deleteLog && deleteLog.target.id === channel.id) {
      executor = deleteLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const channelTypes = {
    0: '💬 Textuel',
    2: '🔊 Vocal',
    4: '📁 Catégorie',
    5: '📢 Annonces',
    13: '🎙️ Stage',
    15: '🧵 Forum'
  };
  
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Salon supprimé')
    .setColor('#FF0000')
    .addFields(
      { name: '📝 Nom', value: channel.name, inline: true },
      { name: '🆔 ID', value: channel.id, inline: true },
      { name: '📋 Type', value: channelTypes[channel.type] || 'Inconnu', inline: true },
      { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
  
  if (executor) {
    embed.addFields({ name: '👤 Supprimé par', value: `${executor} (${executor.id})` });
  }
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la modification de salons
client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  
  const logChannelId = logChannels.channels.get(newChannel.guild.id);
  if (!logChannelId) return;
  
  const logChannel = newChannel.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  const changes = [];
  
  // Vérifier les changements
  if (oldChannel.name !== newChannel.name) {
    changes.push(`**Nom:** ${oldChannel.name} → ${newChannel.name}`);
  }
  
  if (oldChannel.topic !== newChannel.topic) {
    changes.push(`**Sujet:** ${oldChannel.topic || 'Aucun'} → ${newChannel.topic || 'Aucun'}`);
  }
  
  if (oldChannel.nsfw !== newChannel.nsfw) {
    changes.push(`**NSFW:** ${oldChannel.nsfw ? 'Oui' : 'Non'} → ${newChannel.nsfw ? 'Oui' : 'Non'}`);
  }
  
  if (changes.length === 0) return;
  
  // Chercher qui a modifié le salon
  let executor = null;
  try {
    const auditLogs = await newChannel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelUpdate,
      limit: 1
    });
    
    const updateLog = auditLogs.entries.first();
    if (updateLog && updateLog.target.id === newChannel.id && 
        updateLog.createdTimestamp > Date.now() - 5000) {
      executor = updateLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✏️ Salon modifié')
    .setColor('#FFA500')
    .addFields(
      { name: '📝 Salon', value: `${newChannel}`, inline: true },
      { name: '🆔 ID', value: newChannel.id, inline: true },
      { name: '🔄 Modifications', value: changes.join('\n'), inline: false },
      { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
  
  if (executor) {
    embed.addFields({ name: '👤 Modifié par', value: `${executor} (${executor.id})` });
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
