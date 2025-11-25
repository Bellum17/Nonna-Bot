const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent, ChannelType, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { Pool } = require('pg');

// Créer un nouveau client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ]
});

// Configuration PostgreSQL
let pool = null;

// Initialiser PostgreSQL uniquement si DATABASE_URL existe
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('🗄️  PostgreSQL configuré');
}

// Stocker les canaux de logs pour chaque serveur (cache en mémoire)
const logChannels = {
  messages: new Map(),
  voice: new Map(),
  roles: new Map(),
  channels: new Map(),
  members: new Map(),
  invites: new Map()
};

// Stocker les messages pour détecter qui les a supprimés
const messageCache = new Map();

// Stocker les invitations pour suivre qui invite qui
const invitesCache = new Map();

// Fonction pour vérifier si un rôle a des permissions importantes
function hasImportantPermissions(role) {
  const importantPerms = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'KickMembers',
    'BanMembers',
    'ManageMessages',
    'MentionEveryone',
    'ManageWebhooks'
  ];
  
  return importantPerms.some(perm => role.permissions.has(perm));
}

// Fonction pour obtenir les permissions importantes d'un rôle
function getImportantPermissions(role) {
  const perms = [];
  if (role.permissions.has('Administrator')) perms.push('👑 Admin');
  if (role.permissions.has('ManageGuild')) perms.push('⚙️ Gérer serveur');
  if (role.permissions.has('ManageRoles')) perms.push('🎭 Gérer rôles');
  if (role.permissions.has('ManageChannels')) perms.push('📁 Gérer salons');
  if (role.permissions.has('KickMembers')) perms.push('👢 Expulser');
  if (role.permissions.has('BanMembers')) perms.push('🔨 Bannir');
  if (role.permissions.has('ManageMessages')) perms.push('🗑️ Gérer messages');
  if (role.permissions.has('MentionEveryone')) perms.push('📢 @everyone');
  if (role.permissions.has('ManageWebhooks')) perms.push('🔗 Webhooks');
  return perms;
}

// Créer la table si elle n'existe pas
async function ensureTableExists() {
  if (!pool) return false;
  
  try {
    // Créer la table de base
    await pool.query(`
      CREATE TABLE IF NOT EXISTS log_config (
        guild_id VARCHAR(50) PRIMARY KEY,
        log_messages VARCHAR(50),
        log_voice VARCHAR(50),
        log_roles VARCHAR(50),
        log_channels VARCHAR(50),
        log_members VARCHAR(50),
        log_invites VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Vérifier et ajouter les colonnes manquantes (migration)
    try {
      const columnsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'log_config'
      `);
      
      const existingColumns = columnsCheck.rows.map(row => row.column_name);
      
      // Ajouter log_members si elle n'existe pas
      if (!existingColumns.includes('log_members')) {
        await pool.query(`ALTER TABLE log_config ADD COLUMN log_members VARCHAR(50)`);
        console.log('✅ Colonne log_members ajoutée');
      }
      
      // Ajouter log_invites si elle n'existe pas
      if (!existingColumns.includes('log_invites')) {
        await pool.query(`ALTER TABLE log_config ADD COLUMN log_invites VARCHAR(50)`);
        console.log('✅ Colonne log_invites ajoutée');
      }
    } catch (migrationError) {
      console.log('⚠️  Migration déjà effectuée ou erreur:', migrationError.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Erreur création table:', error.message);
    return false;
  }
}

// Charger la configuration depuis PostgreSQL
async function loadConfig() {
  if (!pool) {
    console.log('ℹ️  Pas de base de données configurée');
    return;
  }

  try {
    // S'assurer que la table existe
    const tableExists = await ensureTableExists();
    if (!tableExists) {
      console.log('⚠️  Impossible de créer la table');
      return;
    }

    const result = await pool.query('SELECT * FROM log_config');
    
    let count = 0;
    result.rows.forEach(row => {
      if (row.log_messages) {
        logChannels.messages.set(row.guild_id, row.log_messages);
        count++;
      }
      if (row.log_voice) {
        logChannels.voice.set(row.guild_id, row.log_voice);
        count++;
      }
      if (row.log_roles) {
        logChannels.roles.set(row.guild_id, row.log_roles);
        count++;
      }
      if (row.log_channels) {
        logChannels.channels.set(row.guild_id, row.log_channels);
        count++;
      }
      if (row.log_members) {
        logChannels.members.set(row.guild_id, row.log_members);
        count++;
      }
      if (row.log_invites) {
        logChannels.invites.set(row.guild_id, row.log_invites);
        count++;
      }
    });

    console.log(`✅ Configuration chargée: ${count} logs sur ${result.rows.length} serveurs`);
  } catch (error) {
    console.error('❌ Erreur chargement:', error.message);
  }
}

// Sauvegarder la configuration dans PostgreSQL
async function saveConfig(guildId, logType, channelId) {
  if (!pool) {
    console.log('⚠️  Pas de BDD - Config non sauvegardée');
    return false;
  }

  try {
    // Toujours s'assurer que la table existe avant de sauvegarder
    const tableExists = await ensureTableExists();
    if (!tableExists) {
      console.log('❌ Table non créée');
      return false;
    }

    const columnName = `log_${logType}`;
    
    // Vérifier si la guild existe déjà
    const checkResult = await pool.query(
      'SELECT * FROM log_config WHERE guild_id = $1',
      [guildId]
    );

    if (checkResult.rows.length > 0) {
      // Mise à jour
      await pool.query(
        `UPDATE log_config SET ${columnName} = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2`,
        [channelId, guildId]
      );
      console.log(`✅ Config mise à jour: ${logType}`);
    } else {
      // Insertion
      await pool.query(
        `INSERT INTO log_config (guild_id, ${columnName}) VALUES ($1, $2)`,
        [guildId, channelId]
      );
      console.log(`✅ Config créée: ${logType}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error.message);
    return false;
  }
}

// Événement quand le bot est prêt
client.once('clientReady', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  // Charger la configuration si PostgreSQL est disponible
  if (pool) {
    console.log('🔄 Chargement de la configuration...');
    await loadConfig();
  } else {
    console.log('⚠️  Mode sans base de données - Config temporaire');
  }
  
  // Charger toutes les invitations existantes pour chaque serveur
  console.log('🔄 Chargement des invitations...');
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      invitesCache.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
      console.log(`✅ ${invites.size} invitations chargées pour ${guild.name}`);
    } catch (error) {
      console.error(`❌ Erreur chargement invitations pour ${guild.name}:`, error.message);
    }
  }
  
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
      .addSubcommand(subcommand =>
        subcommand
          .setName('membres')
          .setDescription('Configure les logs des activités des membres')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs de membres')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('invitations')
          .setDescription('Configure les logs des invitations (création, utilisation, inviteur)')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Le salon où envoyer les logs d\'invitations')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Gestion du système de tickets')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('Configure le système de tickets')
          .addChannelOption(option =>
            option
              .setName('salon')
              .setDescription('Le salon où afficher le message de création de tickets')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addChannelOption(option =>
            option
              .setName('categorie')
              .setDescription('La catégorie où créer les tickets')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('permission')
          .setDescription('Définit quel rôle a accès aux tickets créés')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Le rôle qui aura accès aux tickets (staff/support)')
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
      const saved = await saveConfig(interaction.guildId, 'messages', channel.id);
      await interaction.reply({
        content: `✅ Les logs de messages seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}`,
        flags: 64 // MessageFlags.Ephemeral
      });
    }
    
    if (subcommand === 'vocal') {
      logChannels.voice.set(interaction.guildId, channel.id);
      const saved = await saveConfig(interaction.guildId, 'voice', channel.id);
      await interaction.reply({
        content: `✅ Les logs vocaux seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}`,
        flags: 64 // MessageFlags.Ephemeral
      });
    }
    
    if (subcommand === 'roles') {
      logChannels.roles.set(interaction.guildId, channel.id);
      const saved = await saveConfig(interaction.guildId, 'roles', channel.id);
      await interaction.reply({
        content: `✅ Les logs de rôles seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}`,
        flags: 64 // MessageFlags.Ephemeral
      });
    }
    
    if (subcommand === 'salons') {
      logChannels.channels.set(interaction.guildId, channel.id);
      const saved = await saveConfig(interaction.guildId, 'channels', channel.id);
      await interaction.reply({
        content: `✅ Les logs de salons seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}`,
        flags: 64 // MessageFlags.Ephemeral
      });
    }
    
    if (subcommand === 'membres') {
      logChannels.members.set(interaction.guildId, channel.id);
      const saved = await saveConfig(interaction.guildId, 'members', channel.id);
      await interaction.reply({
        content: `✅ Les logs de membres seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}`,
        flags: 64 // MessageFlags.Ephemeral
      });
    }
    
    if (subcommand === 'invitations') {
      logChannels.invites.set(interaction.guildId, channel.id);
      const saved = await saveConfig(interaction.guildId, 'invites', channel.id);
      
      // Charger les invitations pour ce serveur si pas déjà fait
      try {
        const invites = await interaction.guild.invites.fetch();
        invitesCache.set(interaction.guildId, new Map(invites.map(invite => [invite.code, invite.uses])));
        
        // Envoyer un embed dans le salon configuré
        const setupEmbed = new EmbedBuilder()
          .setTitle('🎟️ Système d\'Invitations Configuré')
          .setDescription('Le système de suivi des invitations est maintenant actif dans ce salon !')
          .setColor('#00FF00')
          .addFields(
            { name: '📥 Logs activés', value: '• Création d\'invitations\n• Utilisation d\'invitations\n• Suppression d\'invitations\n• Membres rejoignant le serveur\n• Membres quittant le serveur', inline: false },
            { name: '📊 Statistiques', value: `${invites.size} invitations actuellement actives`, inline: true },
            { name: '✅ Configuration', value: saved ? 'Sauvegardée en base de données' : 'Temporaire (session)', inline: true },
            { name: '📋 Informations suivies', value: '• Qui a invité qui\n• Nombre total d\'invitations par lien\n• Décompte des départs (-1 membre)\n• Raisons des départs (quit/kick/ban)', inline: false }
          )
          .setFooter({ text: `Configuré par ${interaction.user.tag}` })
          .setTimestamp();
        
        await channel.send({ embeds: [setupEmbed] });
        
        await interaction.reply({
          content: `✅ Les logs d'invitations seront envoyés dans ${channel}\n${saved ? '💾 Configuration sauvegardée en BDD!' : '⚠️ Config temporaire (pas de BDD)'}\n📊 ${invites.size} invitations actuellement actives`,
          flags: 64 // MessageFlags.Ephemeral
        });
      } catch (error) {
        await interaction.reply({
          content: `✅ Les logs d'invitations seront envoyés dans ${channel}\n⚠️ Erreur de chargement des invitations: ${error.message}`,
          flags: 64 // MessageFlags.Ephemeral
        });
      }
    }
  }
  
  // Commande /ticket
  if (interaction.commandName === 'ticket') {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('salon');
      const category = interaction.options.getChannel('categorie');
      
      // Vérifier que c'est bien une catégorie
      if (category.type !== 4) {
        return await interaction.reply({
          content: '❌ Vous devez sélectionner une **catégorie** (pas un salon textuel ou vocal)',
          flags: 64
        });
      }
      
      // Créer l'embed du message de tickets
      const ticketEmbed = new EmbedBuilder()
        .setTitle('🎫 Système de Tickets')
        .setDescription('Besoin d\'aide ou d\'assistance ? Créez un ticket en sélectionnant le type de votre demande dans le menu ci-dessous.')
        .setColor('#5865F2')
        .addFields(
          { name: '🆘 Helper', value: 'Pour toute demande d\'aide générale', inline: true },
          { name: '⚠️ Plaintes', value: 'Pour signaler un problème ou une plainte', inline: true },
          { name: '📝 Autre(s)', value: 'Pour toute autre demande spécifique', inline: true },
          { name: '\u200B', value: '**Comment ça marche ?**\n1️⃣ Sélectionnez le type de ticket dans le menu\n2️⃣ Un salon privé sera créé pour vous\n3️⃣ Expliquez votre demande', inline: false }
        )
        .setFooter({ text: 'Temps de réponse moyen : < 24h' })
        .setTimestamp();
      
      // Créer le menu déroulant directement
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_direct')
        .setPlaceholder('📋 Sélectionnez le type de ticket')
        .addOptions([
          {
            label: 'Helper',
            description: 'Demande d\'aide générale',
            value: 'helper',
            emoji: '🆘'
          },
          {
            label: 'Plaintes',
            description: 'Signaler un problème ou une plainte',
            value: 'plaintes',
            emoji: '⚠️'
          },
          {
            label: 'Autre(s)',
            description: 'Autre demande spécifique',
            value: 'autre',
            emoji: '📝'
          }
        ]);
      
      const row = new ActionRowBuilder()
        .addComponents(selectMenu);
      
      // Envoyer le message dans le salon spécifié
      await channel.send({ 
        embeds: [ticketEmbed],
        components: [row]
      });
      
      await interaction.reply({
        content: `✅ Le système de tickets a été configuré dans ${channel}\n📁 Catégorie des tickets : ${category}`,
        flags: 64
      });
      
      // Sauvegarder la configuration (temporaire pour l'instant)
      if (!client.ticketConfig) client.ticketConfig = new Map();
      client.ticketConfig.set(interaction.guildId, {
        categoryId: category.id,
        setupChannelId: channel.id
      });
    }
    
    if (subcommand === 'permission') {
      const role = interaction.options.getRole('role');
      
      // Initialiser la config si elle n'existe pas
      if (!client.ticketConfig) client.ticketConfig = new Map();
      
      const config = client.ticketConfig.get(interaction.guildId) || {};
      config.supportRoleId = role.id;
      client.ticketConfig.set(interaction.guildId, config);
      
      await interaction.reply({
        content: `✅ Le rôle ${role} a été défini comme rôle de support.\nCe rôle aura accès à tous les tickets créés.`,
        flags: 64
      });
    }
  }
  
  // Gestion des boutons
  if (interaction.isButton()) {
    if (interaction.customId === 'create_ticket') {
      const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      
      // Créer le menu déroulant pour sélectionner le type de ticket
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type')
        .setPlaceholder('Sélectionnez le type de ticket')
        .addOptions([
          {
            label: 'Helper',
            description: 'Demande d\'aide générale',
            value: 'helper',
            emoji: '🆘'
          },
          {
            label: 'Plaintes',
            description: 'Signaler un problème ou une plainte',
            value: 'plaintes',
            emoji: '⚠️'
          },
          {
            label: 'Autre(s)',
            description: 'Autre demande spécifique',
            value: 'autre',
            emoji: '📝'
          }
        ]);
      
      const row = new ActionRowBuilder()
        .addComponents(selectMenu);
      
      await interaction.reply({
        content: '🎫 **Création de Ticket**\n\nVeuillez sélectionner le type de votre demande ci-dessous :',
        components: [row],
        flags: 64
      });
    }
    
    if (interaction.customId === 'close_ticket') {
      // Fermer le ticket
      await interaction.reply({
        content: '🔒 Fermeture du ticket dans 5 secondes...',
        flags: 64
      });
      
      setTimeout(async () => {
        await interaction.channel.delete();
      }, 5000);
    }
  }
  
  // Gestion des menus déroulants
  if (interaction.isStringSelectMenu()) {
    // Ancien menu (depuis le bouton - on le garde pour compatibilité)
    if (interaction.customId === 'ticket_type') {
      const ticketType = interaction.values[0];
      
      // Si c'est "Autre", demander une raison
      if (ticketType === 'autre') {
        const modal = new ModalBuilder()
          .setCustomId('ticket_autre_modal')
          .setTitle('Précisez votre demande');
        
        const raisonInput = new TextInputBuilder()
          .setCustomId('raison_ticket')
          .setLabel('Quel est le sujet de votre ticket ?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Décrivez brièvement votre demande...')
          .setRequired(true)
          .setMaxLength(500);
        
        const row = new ActionRowBuilder().addComponents(raisonInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
      } else {
        // Créer le ticket directement
        await createTicket(interaction, ticketType, null);
      }
    }
    
    // Nouveau menu direct (dans le message principal)
    if (interaction.customId === 'ticket_type_direct') {
      const ticketType = interaction.values[0];
      
      // Si c'est "Autre", demander une raison via modal
      if (ticketType === 'autre') {
        const modal = new ModalBuilder()
          .setCustomId('ticket_autre_modal')
          .setTitle('Précisez votre demande');
        
        const raisonInput = new TextInputBuilder()
          .setCustomId('raison_ticket')
          .setLabel('Quel est le sujet de votre ticket ?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Décrivez brièvement votre demande...')
          .setRequired(true)
          .setMaxLength(500);
        
        const row = new ActionRowBuilder().addComponents(raisonInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
      } else {
        // Différer la réponse pour avoir le temps de créer le ticket
        await interaction.deferReply({ flags: 64 });
        
        try {
          // Créer le ticket directement
          await createTicket(interaction, ticketType, null);
        } catch (error) {
          console.error('Erreur lors de la création du ticket:', error);
          await interaction.editReply({
            content: '❌ Une erreur est survenue lors de la création du ticket.',
            flags: 64
          });
        }
      }
    }
  }
  
  // Gestion des modals
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'ticket_autre_modal') {
      await interaction.deferReply({ flags: 64 });
      
      try {
        const raison = interaction.fields.getTextInputValue('raison_ticket');
        await createTicket(interaction, 'autre', raison);
      } catch (error) {
        console.error('Erreur lors de la création du ticket:', error);
        await interaction.editReply({
          content: '❌ Une erreur est survenue lors de la création du ticket.',
          flags: 64
        });
      }
    }
  }
});

// Fonction pour créer un ticket
async function createTicket(interaction, type, raison = null) {
  const config = client.ticketConfig?.get(interaction.guildId);
  if (!config) {
    return await interaction.reply({
      content: '❌ Le système de tickets n\'est pas configuré sur ce serveur.',
      flags: 64
    });
  }
  
  const typeEmojis = {
    helper: '🆘',
    plaintes: '⚠️',
    autre: '📝'
  };
  
  const typeNames = {
    helper: 'Helper',
    plaintes: 'Plaintes',
    autre: 'Autre'
  };
  
  const typeColors = {
    helper: '#00FF00',
    plaintes: '#FF6600',
    autre: '#5865F2'
  };
  
  const typeDescriptions = {
    helper: 'Merci d\'avoir ouvert un ticket d\'aide ! Un membre du staff va vous assister rapidement.\n\n**Conseils :**\n• Expliquez votre problème de manière détaillée\n• Ajoutez des captures d\'écran si nécessaire\n• Soyez patient, nous répondons dès que possible',
    plaintes: 'Merci d\'avoir ouvert un ticket de plainte. Nous prenons votre retour au sérieux.\n\n**Informations importantes :**\n• Décrivez la situation avec précision\n• Fournissez des preuves si possible\n• Restez respectueux dans vos propos',
    autre: 'Merci d\'avoir ouvert un ticket ! Un membre du staff va examiner votre demande.\n\n**À savoir :**\n• Votre demande sera traitée dans les meilleurs délais\n• N\'hésitez pas à fournir tous les détails nécessaires'
  };
  
  // Préparer les permissions de base
  const permissionOverwrites = [
    {
      id: interaction.guild.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];
  
  // Ajouter le rôle autorisé s'il existe
  if (config.supportRoleId) {
    permissionOverwrites.push({
      id: config.supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }
  
  // Créer le salon de ticket
  const ticketChannel = await interaction.guild.channels.create({
    name: `${typeEmojis[type]}-${interaction.user.username}`,
    type: ChannelType.GuildText,
    parent: config.categoryId,
    permissionOverwrites: permissionOverwrites
  });
  
  // Créer l'embed du ticket avec message personnalisé selon le type
  const ticketEmbed = new EmbedBuilder()
    .setTitle(`${typeEmojis[type]} Ticket - ${typeNames[type]}`)
    .setDescription(
      `Bonjour ${interaction.user} !\n\n` +
      typeDescriptions[type] +
      (raison ? `\n\n**📝 Votre demande :**\n${raison}` : '')
    )
    .setColor(typeColors[type])
    .addFields(
      { name: '👤 Créé par', value: `${interaction.user.tag}`, inline: true },
      { name: '📋 Type', value: typeNames[type], inline: true },
      { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setFooter({ text: 'Utilisez le bouton rouge ci-dessous pour fermer le ticket' })
    .setTimestamp();
  
  // Bouton pour fermer le ticket (rouge)
  const closeButton = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Fermer le Ticket')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);
  
  const row = new ActionRowBuilder()
    .addComponents(closeButton);
  
  // Mentionner l'utilisateur et le rôle support s'il existe
  await ticketChannel.send({
    content: `${interaction.user}${config.supportRoleId ? ` - <@&${config.supportRoleId}>` : ''}`,
    embeds: [ticketEmbed],
    components: [row]
  });
  
  // Vérifier si l'interaction a déjà été différée ou répondue
  if (interaction.deferred) {
    await interaction.editReply({
      content: `✅ Votre ticket a été créé : ${ticketChannel}`,
      flags: 64
    });
  } else if (!interaction.replied) {
    await interaction.reply({
      content: `✅ Votre ticket a été créé : ${ticketChannel}`,
      flags: 64
    });
  }
}

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
    const roleDetails = addedRoles.map(role => {
      const perms = [];
      if (role.permissions.has('Administrator')) perms.push('👑 Admin');
      if (role.permissions.has('ManageGuild')) perms.push('⚙️ Gérer serveur');
      if (role.permissions.has('ManageRoles')) perms.push('🎭 Gérer rôles');
      if (role.permissions.has('ManageChannels')) perms.push('📁 Gérer salons');
      if (role.permissions.has('KickMembers')) perms.push('👢 Expulser');
      if (role.permissions.has('BanMembers')) perms.push('🔨 Bannir');
      if (role.permissions.has('ManageMessages')) perms.push('🗑️ Gérer messages');
      
      return `${role} ${perms.length > 0 ? `\n└ ${perms.join(', ')}` : ''}`;
    }).join('\n');
    
    embed.addFields({ 
      name: '✅ Rôles ajoutés', 
      value: roleDetails.substring(0, 1024)
    });
  }
  
  if (removedRoles.size > 0) {
    const roleDetails = removedRoles.map(role => {
      const perms = [];
      if (role.permissions.has('Administrator')) perms.push('👑 Admin');
      if (role.permissions.has('ManageGuild')) perms.push('⚙️ Gérer serveur');
      if (role.permissions.has('ManageRoles')) perms.push('🎭 Gérer rôles');
      if (role.permissions.has('ManageChannels')) perms.push('📁 Gérer salons');
      if (role.permissions.has('KickMembers')) perms.push('👢 Expulser');
      if (role.permissions.has('BanMembers')) perms.push('🔨 Bannir');
      if (role.permissions.has('ManageMessages')) perms.push('🗑️ Gérer messages');
      
      return `${role} ${perms.length > 0 ? `\n└ ${perms.join(', ')}` : ''}`;
    }).join('\n');
    
    embed.addFields({ 
      name: '❌ Rôles retirés', 
      value: roleDetails.substring(0, 1024)
    });
  }
  
  if (executor) {
    embed.addFields({ name: '⚙️ Modifié par', value: `${executor} (${executor.id})` });
  }
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la création de rôles
client.on('roleCreate', async (role) => {
  const logChannelId = logChannels.roles.get(role.guild.id);
  if (!logChannelId) return;
  
  const logChannel = role.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Chercher qui a créé le rôle
  let executor = null;
  try {
    const auditLogs = await role.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleCreate,
      limit: 1
    });
    
    const createLog = auditLogs.entries.first();
    if (createLog && createLog.target.id === role.id) {
      executor = createLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎭 Rôle créé')
    .setColor(role.color || '#99AAB5')
    .addFields(
      { name: '📝 Nom', value: role.name, inline: true },
      { name: '🆔 ID', value: role.id, inline: true },
      { name: '🎨 Couleur', value: role.hexColor, inline: true },
      { name: '📊 Position', value: role.position.toString(), inline: true },
      { name: '🏷️ Mentionnable', value: role.mentionable ? '✅' : '❌', inline: true },
      { name: '👁️ Affiché séparément', value: role.hoist ? '✅' : '❌', inline: true }
    )
    .setTimestamp();
  
  // Permissions importantes
  const importantPerms = [];
  if (role.permissions.has('Administrator')) importantPerms.push('👑 Administrateur');
  if (role.permissions.has('ManageGuild')) importantPerms.push('⚙️ Gérer le serveur');
  if (role.permissions.has('ManageRoles')) importantPerms.push('🎭 Gérer les rôles');
  if (role.permissions.has('ManageChannels')) importantPerms.push('📁 Gérer les salons');
  if (role.permissions.has('KickMembers')) importantPerms.push('👢 Expulser des membres');
  if (role.permissions.has('BanMembers')) importantPerms.push('🔨 Bannir des membres');
  if (role.permissions.has('ManageMessages')) importantPerms.push('🗑️ Gérer les messages');
  if (role.permissions.has('MentionEveryone')) importantPerms.push('📢 Mentionner @everyone');
  
  if (importantPerms.length > 0) {
    embed.addFields({ name: '🔐 Permissions importantes', value: importantPerms.join('\n') });
  }
  
  if (executor) {
    embed.addFields({ name: '👤 Créé par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la suppression de rôles
client.on('roleDelete', async (role) => {
  const logChannelId = logChannels.roles.get(role.guild.id);
  if (!logChannelId) return;
  
  const logChannel = role.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Chercher qui a supprimé le rôle
  let executor = null;
  try {
    const auditLogs = await role.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleDelete,
      limit: 1
    });
    
    const deleteLog = auditLogs.entries.first();
    if (deleteLog && deleteLog.target.id === role.id) {
      executor = deleteLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Rôle supprimé')
    .setColor('#FF0000')
    .addFields(
      { name: '📝 Nom', value: role.name, inline: true },
      { name: '🆔 ID', value: role.id, inline: true },
      { name: '🎨 Couleur', value: role.hexColor, inline: true },
      { name: '📊 Position', value: role.position.toString(), inline: true },
      { name: '👥 Membres', value: role.members.size.toString(), inline: true }
    )
    .setTimestamp();
  
  if (executor) {
    embed.addFields({ name: '👤 Supprimé par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la modification de rôles
client.on('roleUpdate', async (oldRole, newRole) => {
  const logChannelId = logChannels.roles.get(newRole.guild.id);
  if (!logChannelId) return;
  
  const logChannel = newRole.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  const changes = [];
  
  // Vérifier les changements
  if (oldRole.name !== newRole.name) {
    changes.push(`**📝 Nom:** ${oldRole.name} → ${newRole.name}`);
  }
  
  if (oldRole.color !== newRole.color) {
    changes.push(`**🎨 Couleur:** ${oldRole.hexColor} → ${newRole.hexColor}`);
  }
  
  if (oldRole.hoist !== newRole.hoist) {
    changes.push(`**👁️ Affiché séparément:** ${oldRole.hoist ? 'Oui' : 'Non'} → ${newRole.hoist ? 'Oui' : 'Non'}`);
  }
  
  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`**🏷️ Mentionnable:** ${oldRole.mentionable ? 'Oui' : 'Non'} → ${newRole.mentionable ? 'Oui' : 'Non'}`);
  }
  
  if (oldRole.position !== newRole.position) {
    changes.push(`**📊 Position:** ${oldRole.position} → ${newRole.position}`);
  }
  
  // Vérifier les changements de permissions
  const addedPerms = newRole.permissions.missing(oldRole.permissions);
  const removedPerms = oldRole.permissions.missing(newRole.permissions);
  
  const permissionNames = {
    'Administrator': '👑 Administrateur',
    'ManageGuild': '⚙️ Gérer le serveur',
    'ManageRoles': '🎭 Gérer les rôles',
    'ManageChannels': '📁 Gérer les salons',
    'KickMembers': '👢 Expulser',
    'BanMembers': '🔨 Bannir',
    'ManageMessages': '🗑️ Gérer les messages',
    'MentionEveryone': '📢 Mention @everyone',
    'ViewAuditLog': '📋 Voir les logs',
    'ManageWebhooks': '🔗 Gérer les webhooks',
    'ManageEmojisAndStickers': '😀 Gérer emojis',
    'ViewChannel': '👁️ Voir le salon',
    'SendMessages': '💬 Envoyer des messages',
    'EmbedLinks': '🔗 Intégrer des liens',
    'AttachFiles': '📎 Joindre des fichiers',
    'AddReactions': '😊 Ajouter des réactions',
    'UseExternalEmojis': '😀 Emojis externes',
    'Connect': '🔊 Se connecter (vocal)',
    'Speak': '🎤 Parler',
    'MuteMembers': '🔇 Rendre muet',
    'DeafenMembers': '🔇 Mettre en sourdine',
    'MoveMembers': '↔️ Déplacer des membres'
  };
  
  if (addedPerms.length > 0) {
    const perms = addedPerms.map(p => permissionNames[p] || p).join(', ');
    changes.push(`**✅ Permissions ajoutées:** ${perms}`);
  }
  
  if (removedPerms.length > 0) {
    const perms = removedPerms.map(p => permissionNames[p] || p).join(', ');
    changes.push(`**❌ Permissions retirées:** ${perms}`);
  }
  
  if (changes.length === 0) return;
  
  // Chercher qui a modifié le rôle
  let executor = null;
  try {
    const auditLogs = await newRole.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleUpdate,
      limit: 1
    });
    
    const updateLog = auditLogs.entries.first();
    if (updateLog && updateLog.target.id === newRole.id && 
        updateLog.createdTimestamp > Date.now() - 5000) {
      executor = updateLog.executor;
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des logs d\'audit:', error);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✏️ Rôle modifié')
    .setColor(newRole.color || '#FFA500')
    .addFields(
      { name: '🎭 Rôle', value: `${newRole}`, inline: true },
      { name: '🆔 ID', value: newRole.id, inline: true },
      { name: '🔄 Modifications', value: changes.join('\n').substring(0, 1024), inline: false }
    )
    .setTimestamp();
  
  if (executor) {
    embed.addFields({ name: '👤 Modifié par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
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
      { name: '📋 Type', value: channelTypes[channel.type] || 'Inconnu', inline: true }
    )
    .setTimestamp();
  
  // Ajouter des détails selon le type
  if (channel.type === 0) { // Textuel
    if (channel.topic) embed.addFields({ name: '� Sujet', value: channel.topic.substring(0, 1024) });
    embed.addFields({ 
      name: '⚙️ Paramètres', 
      value: `NSFW: ${channel.nsfw ? '✅' : '❌'}\nRalenti: ${channel.rateLimitPerUser}s` 
    });
  }
  
  if (channel.type === 2) { // Vocal
    embed.addFields({ 
      name: '⚙️ Paramètres', 
      value: `Limite utilisateurs: ${channel.userLimit || 'Illimité'}\nQualité audio: ${channel.bitrate / 1000}kbps` 
    });
  }
  
  if (channel.parent) {
    embed.addFields({ name: '📁 Catégorie', value: channel.parent.name });
  }
  
  if (executor) {
    embed.addFields({ name: '👤 Créé par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
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
      { name: '📋 Type', value: channelTypes[channel.type] || 'Inconnu', inline: true }
    )
    .setTimestamp();
  
  // Ajouter des détails selon le type
  if (channel.type === 0 && channel.topic) {
    embed.addFields({ name: '� Sujet', value: channel.topic.substring(0, 1024) });
  }
  
  if (channel.parent) {
    embed.addFields({ name: '📁 Catégorie', value: channel.parent.name });
  }
  
  if (executor) {
    embed.addFields({ name: '👤 Supprimé par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
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
  
  // Vérifier les changements généraux
  if (oldChannel.name !== newChannel.name) {
    changes.push(`**📝 Nom:** ${oldChannel.name} → ${newChannel.name}`);
  }
  
  if (oldChannel.position !== newChannel.position) {
    changes.push(`**📊 Position:** ${oldChannel.position} → ${newChannel.position}`);
  }
  
  // Changements de catégorie
  if (oldChannel.parentId !== newChannel.parentId) {
    const oldParent = oldChannel.parent ? oldChannel.parent.name : 'Aucune';
    const newParent = newChannel.parent ? newChannel.parent.name : 'Aucune';
    changes.push(`**📁 Catégorie:** ${oldParent} → ${newParent}`);
  }
  
  // Changements pour salons textuels
  if (oldChannel.type === 0) {
    if (oldChannel.topic !== newChannel.topic) {
      const oldTopic = oldChannel.topic || 'Aucun';
      const newTopic = newChannel.topic || 'Aucun';
      changes.push(`**📄 Sujet:** ${oldTopic.substring(0, 50)} → ${newTopic.substring(0, 50)}`);
    }
    
    if (oldChannel.nsfw !== newChannel.nsfw) {
      changes.push(`**🔞 NSFW:** ${oldChannel.nsfw ? 'Oui' : 'Non'} → ${newChannel.nsfw ? 'Oui' : 'Non'}`);
    }
    
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push(`**⏱️ Ralenti:** ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
    }
  }
  
  // Changements pour salons vocaux
  if (oldChannel.type === 2) {
    if (oldChannel.bitrate !== newChannel.bitrate) {
      changes.push(`**🎵 Qualité audio:** ${oldChannel.bitrate / 1000}kbps → ${newChannel.bitrate / 1000}kbps`);
    }
    
    if (oldChannel.userLimit !== newChannel.userLimit) {
      const oldLimit = oldChannel.userLimit || 'Illimité';
      const newLimit = newChannel.userLimit || 'Illimité';
      changes.push(`**👥 Limite utilisateurs:** ${oldLimit} → ${newLimit}`);
    }
    
    if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
      const oldRegion = oldChannel.rtcRegion || 'Auto';
      const newRegion = newChannel.rtcRegion || 'Auto';
      changes.push(`**🌍 Région:** ${oldRegion} → ${newRegion}`);
    }
  }
  
  // Vérifier les changements de permissions
  const oldPerms = oldChannel.permissionOverwrites.cache;
  const newPerms = newChannel.permissionOverwrites.cache;
  
  const permChanges = [];
  
  // Permissions ajoutées
  newPerms.forEach(newPerm => {
    const oldPerm = oldPerms.get(newPerm.id);
    if (!oldPerm) {
      // Nouvelle permission ajoutée
      const target = newPerm.type === 0 ? `<@&${newPerm.id}>` : `<@${newPerm.id}>`;
      const targetType = newPerm.type === 0 ? '🎭 Rôle' : '👤 Membre';
      permChanges.push(`**✅ ${targetType} ajouté:** ${target}`);
    } else {
      // Permission modifiée - vérifier les différences
      const allowChanges = [];
      const denyChanges = [];
      
      // Comparer les permissions autorisées
      if (newPerm.allow.bitfield !== oldPerm.allow.bitfield) {
        const newAllows = newPerm.allow.toArray();
        const oldAllows = oldPerm.allow.toArray();
        const added = newAllows.filter(p => !oldAllows.includes(p));
        const removed = oldAllows.filter(p => !newAllows.includes(p));
        
        if (added.length > 0) allowChanges.push(`✅ ${added.join(', ')}`);
        if (removed.length > 0) allowChanges.push(`❌ ${removed.join(', ')}`);
      }
      
      // Comparer les permissions refusées
      if (newPerm.deny.bitfield !== oldPerm.deny.bitfield) {
        const newDenies = newPerm.deny.toArray();
        const oldDenies = oldPerm.deny.toArray();
        const added = newDenies.filter(p => !oldDenies.includes(p));
        const removed = oldDenies.filter(p => !newDenies.includes(p));
        
        if (added.length > 0) denyChanges.push(`🚫 ${added.join(', ')}`);
        if (removed.length > 0) denyChanges.push(`✅ ${removed.join(', ')} (refus retiré)`);
      }
      
      if (allowChanges.length > 0 || denyChanges.length > 0) {
        const target = newPerm.type === 0 ? `<@&${newPerm.id}>` : `<@${newPerm.id}>`;
        const targetType = newPerm.type === 0 ? '🎭 Rôle' : '👤 Membre';
        permChanges.push(`**🔧 ${targetType}:** ${target}\n${[...allowChanges, ...denyChanges].join('\n')}`);
      }
    }
  });
  
  // Permissions supprimées
  oldPerms.forEach(oldPerm => {
    if (!newPerms.has(oldPerm.id)) {
      const target = oldPerm.type === 0 ? `<@&${oldPerm.id}>` : `<@${oldPerm.id}>`;
      const targetType = oldPerm.type === 0 ? '🎭 Rôle' : '👤 Membre';
      permChanges.push(`**❌ ${targetType} retiré:** ${target}`);
    }
  });
  
  if (changes.length === 0 && permChanges.length === 0) return;
  
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
      { name: '🆔 ID', value: newChannel.id, inline: true }
    )
    .setTimestamp();
  
  if (changes.length > 0) {
    embed.addFields({ name: '🔄 Modifications', value: changes.join('\n').substring(0, 1024), inline: false });
  }
  
  if (permChanges.length > 0) {
    embed.addFields({ 
      name: '� Permissions modifiées', 
      value: permChanges.join('\n').substring(0, 1024), 
      inline: false 
    });
  }
  
  if (executor) {
    embed.addFields({ name: '👤 Modifié par', value: `${executor} (${executor.id})` });
  }
  
  embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
  
  await logChannel.send({ embeds: [embed] });
});

// ========== LOGS MEMBRES ==========

// Logger l'arrivée d'un membre
client.on('guildMemberAdd', async (member) => {
  // Détecter qui a invité le membre
  let inviter = null;
  let inviteCode = null;
  
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invitesCache.get(member.guild.id) || new Map();
    
    // Comparer les utilisations pour trouver quelle invitation a été utilisée
    for (const [code, invite] of newInvites) {
      const oldUses = oldInvites.get(code) || 0;
      if (invite.uses > oldUses) {
        inviter = invite.inviter;
        inviteCode = code;
        break;
      }
    }
    
    // Mettre à jour le cache
    invitesCache.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
  } catch (error) {
    console.error('Erreur détection inviteur:', error.message);
  }
  
  // Log dans le salon des membres
  const memberLogChannelId = logChannels.members.get(member.guild.id);
  if (memberLogChannelId) {
    const logChannel = member.guild.channels.cache.get(memberLogChannelId);
    if (logChannel) {
      const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
      
      const embed = new EmbedBuilder()
        .setTitle('📥 Membre a rejoint le serveur')
        .setColor('#00FF00')
        .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
        .addFields(
          { name: '👤 Membre', value: `${member.user} (${member.user.tag})`, inline: true },
          { name: '🆔 ID', value: member.user.id, inline: true },
          { name: '📊 Membres totaux', value: member.guild.memberCount.toString(), inline: true },
          { name: '📅 Compte créé le', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>\n(<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)`, inline: false },
          { name: '⏰ Âge du compte', value: `${accountAge} jours`, inline: true },
          { name: '📥 A rejoint le', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false }
        )
        .setFooter({ text: `ID: ${member.user.id}` })
        .setTimestamp();
      
      // Afficher qui a invité
      if (inviter && inviteCode) {
        embed.addFields({ 
          name: '🎟️ Invité par', 
          value: `${inviter} (${inviter.tag})\nCode: \`${inviteCode}\``, 
          inline: false 
        });
      }
      
      // Avertissement si compte récent
      if (accountAge < 7) {
        embed.addFields({ name: '⚠️ Attention', value: `Compte créé il y a seulement ${accountAge} jours` });
        embed.setColor('#FFA500');
      }
      
      await logChannel.send({ embeds: [embed] });
    }
  }
  
  // Log dans le salon des invitations
  if (inviter && inviteCode) {
    const inviteLogChannelId = logChannels.invites.get(member.guild.id);
    if (inviteLogChannelId) {
      const logChannel = member.guild.channels.cache.get(inviteLogChannelId);
      if (logChannel) {
        // Compter le nombre total de personnes invitées via ce code
        const currentInvites = invitesCache.get(member.guild.id);
        const totalUses = currentInvites?.get(inviteCode) || 0;
        
        const embed = new EmbedBuilder()
          .setTitle('🎟️ Invitation utilisée')
          .setColor('#00FF00')
          .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
          .addFields(
            { name: '👤 Nouveau membre', value: `${member.user} (${member.user.tag})`, inline: false },
            { name: '🎫 Invité par', value: `${inviter} (${inviter.tag})`, inline: true },
            { name: '🔑 Code d\'invitation', value: `\`${inviteCode}\``, inline: true },
            { name: '📊 Utilisations totales', value: `${totalUses} personnes invitées via ce lien`, inline: false },
            { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
          )
          .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
      }
    }
  }
});

// Logger le départ d'un membre
client.on('guildMemberRemove', async (member) => {
  const logChannelId = logChannels.members.get(member.guild.id);
  if (!logChannelId) return;
  
  const logChannel = member.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Vérifier si le membre a été banni ou kick
  let action = 'quitté';
  let executor = null;
  let color = '#FF0000';
  
  try {
    const banLogs = await member.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberBanAdd,
      limit: 1
    });
    
    const banLog = banLogs.entries.first();
    if (banLog && banLog.target.id === member.user.id && 
        banLog.createdTimestamp > Date.now() - 5000) {
      action = 'banni';
      executor = banLog.executor;
      color = '#8B0000';
    } else {
      const kickLogs = await member.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberKick,
        limit: 1
      });
      
      const kickLog = kickLogs.entries.first();
      if (kickLog && kickLog.target.id === member.user.id && 
          kickLog.createdTimestamp > Date.now() - 5000) {
        action = 'expulsé';
        executor = kickLog.executor;
        color = '#FF6600';
      }
    }
  } catch (error) {
    console.error('Erreur audit logs:', error);
  }
  
  const timeOnServer = member.joinedTimestamp ? 
    Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24)) : 'Inconnu';
  
  const embed = new EmbedBuilder()
    .setTitle(`📤 Membre a ${action} le serveur`)
    .setColor(color)
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .addFields(
      { name: '👤 Membre', value: `${member.user} (${member.user.tag})`, inline: true },
      { name: '🆔 ID', value: member.user.id, inline: true },
      { name: '📊 Membres restants', value: member.guild.memberCount.toString(), inline: true },
      { name: '📥 Avait rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Inconnu', inline: false },
      { name: '⏰ Temps sur le serveur', value: `${timeOnServer} jours`, inline: true }
    )
    .setFooter({ text: `ID: ${member.user.id}` })
    .setTimestamp();
  
  // Afficher les rôles qu'il avait
  const roles = member.roles.cache.filter(role => role.id !== member.guild.id);
  if (roles.size > 0) {
    const roleList = roles.map(role => {
      const hasImportant = hasImportantPermissions(role);
      return hasImportant ? `⚠️ ${role}` : role.toString();
    }).join(', ');
    
    embed.addFields({ 
      name: `🎭 Rôles (${roles.size})`, 
      value: roleList.substring(0, 1024) 
    });
  }
  
  if (executor) {
    embed.addFields({ name: action === 'banni' ? '🔨 Banni par' : '👢 Expulsé par', value: `${executor} (${executor.id})` });
  }
  
  await logChannel.send({ embeds: [embed] });
  
  // Log dans le salon des invitations (décompte)
  const inviteLogChannelId = logChannels.invites.get(member.guild.id);
  if (inviteLogChannelId) {
    const inviteLogChannel = member.guild.channels.cache.get(inviteLogChannelId);
    if (inviteLogChannel) {
      const inviteEmbed = new EmbedBuilder()
        .setTitle('📉 Membre a quitté le serveur')
        .setColor(color)
        .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
        .addFields(
          { name: '👤 Membre', value: `${member.user} (${member.user.tag})`, inline: false },
          { name: '📊 Action', value: action === 'quitté' ? '🚪 A quitté' : action === 'banni' ? '🔨 Banni' : '👢 Expulsé', inline: true },
          { name: '⏰ Temps sur le serveur', value: `${timeOnServer} jours`, inline: true },
          { name: '📉 Compteur', value: `-1 membre`, inline: false },
          { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setTimestamp();
      
      if (executor) {
        inviteEmbed.addFields({ name: action === 'banni' ? '🔨 Banni par' : '👢 Expulsé par', value: `${executor}` });
      }
      
      await inviteLogChannel.send({ embeds: [inviteEmbed] });
    }
  }
});

// Logger les mises à jour des membres
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannelId = logChannels.members.get(newMember.guild.id);
  if (!logChannelId) return;
  
  const logChannel = newMember.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Changement de pseudo serveur
  if (oldMember.nickname !== newMember.nickname) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Pseudo serveur modifié')
      .setColor('#3498DB')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: '👤 Membre', value: `${newMember.user}`, inline: true },
        { name: '🆔 ID', value: newMember.user.id, inline: true },
        { name: '📝 Ancien pseudo', value: oldMember.nickname || oldMember.user.username, inline: false },
        { name: '📝 Nouveau pseudo', value: newMember.nickname || newMember.user.username, inline: false },
        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
      )
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
  }
  
  // Changement d'avatar serveur
  if (oldMember.avatar !== newMember.avatar) {
    const embed = new EmbedBuilder()
      .setTitle('🖼️ Avatar serveur modifié')
      .setColor('#9B59B6')
      .addFields(
        { name: '👤 Membre', value: `${newMember.user}`, inline: true },
        { name: '🆔 ID', value: newMember.user.id, inline: true },
        { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
      )
      .setTimestamp();
    
    if (oldMember.avatar) {
      embed.setThumbnail(oldMember.displayAvatarURL({ size: 512 }));
      embed.addFields({ name: '🖼️ Ancien avatar serveur', value: '[Voir l\'image]('+oldMember.displayAvatarURL({ size: 512 })+')' });
    }
    
    if (newMember.avatar) {
      embed.setImage(newMember.displayAvatarURL({ size: 512 }));
      embed.addFields({ name: '🖼️ Nouvel avatar serveur', value: '[Voir l\'image]('+newMember.displayAvatarURL({ size: 512 })+')' });
    } else {
      embed.addFields({ name: '🖼️ Avatar serveur', value: 'Avatar serveur retiré' });
    }
    
    await logChannel.send({ embeds: [embed] });
  }
  
  // Changement de rôles
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  
  const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
  const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
  
  if (addedRoles.size > 0 || removedRoles.size > 0) {
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
      console.error('Erreur audit logs:', error);
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🎭 Rôles modifiés')
      .setColor('#9B59B6')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: '👤 Membre', value: `${newMember.user}`, inline: true },
        { name: '🆔 ID', value: newMember.user.id, inline: true }
      )
      .setTimestamp();
    
    if (addedRoles.size > 0) {
      const roleDetails = addedRoles.map(role => {
        const hasImportant = hasImportantPermissions(role);
        const perms = getImportantPermissions(role);
        const warning = hasImportant ? '⚠️ ' : '';
        return `${warning}${role}${perms.length > 0 ? `\n└ ${perms.join(', ')}` : ''}`;
      }).join('\n');
      
      embed.addFields({ 
        name: '✅ Rôles ajoutés', 
        value: roleDetails.substring(0, 1024)
      });
    }
    
    if (removedRoles.size > 0) {
      const roleDetails = removedRoles.map(role => {
        const hasImportant = hasImportantPermissions(role);
        const perms = getImportantPermissions(role);
        const warning = hasImportant ? '⚠️ ' : '';
        return `${warning}${role}${perms.length > 0 ? `\n└ ${perms.join(', ')}` : ''}`;
      }).join('\n');
      
      embed.addFields({ 
        name: '❌ Rôles retirés', 
        value: roleDetails.substring(0, 1024)
      });
    }
    
    if (executor) {
      embed.addFields({ name: '⚙️ Modifié par', value: `${executor}` });
    }
    
    embed.addFields({ name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` });
    
    await logChannel.send({ embeds: [embed] });
  }
});

// Logger les changements d'utilisateur (avatar global, nom d'utilisateur, bannière)
client.on('userUpdate', async (oldUser, newUser) => {
  // Vérifier dans quels serveurs l'utilisateur est présent
  client.guilds.cache.forEach(async guild => {
    const logChannelId = logChannels.members.get(guild.id);
    if (!logChannelId) return;
    
    const member = guild.members.cache.get(newUser.id);
    if (!member) return; // L'utilisateur n'est pas dans ce serveur
    
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;
    
    // Changement de nom d'utilisateur
    if (oldUser.username !== newUser.username) {
      const embed = new EmbedBuilder()
        .setTitle('👤 Nom d\'utilisateur modifié')
        .setColor('#E74C3C')
        .setThumbnail(newUser.displayAvatarURL())
        .addFields(
          { name: '👤 Utilisateur', value: `${newUser}`, inline: true },
          { name: '🆔 ID', value: newUser.id, inline: true },
          { name: '📝 Ancien nom', value: oldUser.username, inline: false },
          { name: '📝 Nouveau nom', value: newUser.username, inline: false },
          { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setTimestamp();
      
      await logChannel.send({ embeds: [embed] });
    }
    
    // Changement d'avatar global
    if (oldUser.avatar !== newUser.avatar) {
      const embed = new EmbedBuilder()
        .setTitle('🖼️ Avatar global modifié')
        .setColor('#1ABC9C')
        .addFields(
          { name: '👤 Utilisateur', value: `${newUser}`, inline: true },
          { name: '🆔 ID', value: newUser.id, inline: true },
          { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setTimestamp();
      
      if (oldUser.avatar) {
        embed.setThumbnail(oldUser.displayAvatarURL({ size: 512 }));
        embed.addFields({ name: '🖼️ Ancien avatar', value: '[Voir l\'image]('+oldUser.displayAvatarURL({ size: 512 })+')' });
      }
      
      if (newUser.avatar) {
        embed.setImage(newUser.displayAvatarURL({ size: 512 }));
        embed.addFields({ name: '🖼️ Nouvel avatar', value: '[Voir l\'image]('+newUser.displayAvatarURL({ size: 512 })+')' });
      }
      
      await logChannel.send({ embeds: [embed] });
    }
    
    // Changement de bannière
    if (oldUser.banner !== newUser.banner) {
      const embed = new EmbedBuilder()
        .setTitle('🎨 Bannière modifiée')
        .setColor('#F39C12')
        .setThumbnail(newUser.displayAvatarURL())
        .addFields(
          { name: '👤 Utilisateur', value: `${newUser}`, inline: true },
          { name: '🆔 ID', value: newUser.id, inline: true },
          { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setTimestamp();
      
      if (newUser.banner) {
        const bannerURL = newUser.bannerURL({ size: 1024 });
        embed.setImage(bannerURL);
        embed.addFields({ name: '🎨 Nouvelle bannière', value: '[Voir l\'image]('+bannerURL+')' });
      } else {
        embed.addFields({ name: '🎨 Bannière', value: 'Bannière retirée' });
      }
      
      await logChannel.send({ embeds: [embed] });
    }
  });
});

// ========== LOGS INVITATIONS ==========

// Logger la création d'une invitation
client.on('inviteCreate', async (invite) => {
  const logChannelId = logChannels.invites.get(invite.guild.id);
  if (!logChannelId) return;
  
  const logChannel = invite.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Ajouter l'invitation au cache
  if (!invitesCache.has(invite.guild.id)) {
    invitesCache.set(invite.guild.id, new Map());
  }
  invitesCache.get(invite.guild.id).set(invite.code, invite.uses || 0);
  
  const embed = new EmbedBuilder()
    .setTitle('➕ Invitation créée')
    .setColor('#00FF00')
    .addFields(
      { name: '🔑 Code', value: `\`${invite.code}\``, inline: true },
      { name: '🔗 Lien', value: `[discord.gg/${invite.code}](${invite.url})`, inline: true },
      { name: '👤 Créée par', value: invite.inviter ? `${invite.inviter} (${invite.inviter.tag})` : 'Inconnu', inline: false },
      { name: '📍 Salon', value: `${invite.channel}`, inline: true },
      { name: '⏰ Expire', value: invite.maxAge === 0 ? 'Jamais' : `<t:${Math.floor((Date.now() + invite.maxAge * 1000) / 1000)}:R>`, inline: true },
      { name: '📊 Utilisations max', value: invite.maxUses === 0 ? 'Illimité' : invite.maxUses.toString(), inline: true },
      { name: '👥 Temporaire', value: invite.temporary ? 'Oui' : 'Non', inline: true },
      { name: '📅 Date de création', value: `<t:${Math.floor(invite.createdTimestamp / 1000)}:F>` }
    )
    .setTimestamp();
  
  if (invite.inviter) {
    embed.setThumbnail(invite.inviter.displayAvatarURL());
  }
  
  await logChannel.send({ embeds: [embed] });
});

// Logger la suppression d'une invitation
client.on('inviteDelete', async (invite) => {
  const logChannelId = logChannels.invites.get(invite.guild.id);
  if (!logChannelId) return;
  
  const logChannel = invite.guild.channels.cache.get(logChannelId);
  if (!logChannel) return;
  
  // Retirer l'invitation du cache
  if (invitesCache.has(invite.guild.id)) {
    invitesCache.get(invite.guild.id).delete(invite.code);
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Invitation supprimée')
    .setColor('#FF0000')
    .addFields(
      { name: '🔑 Code', value: `\`${invite.code}\``, inline: true },
      { name: '👤 Créée par', value: invite.inviter ? `${invite.inviter} (${invite.inviter.tag})` : 'Inconnu', inline: true },
      { name: '📍 Salon', value: `${invite.channel}`, inline: true },
      { name: '📊 Utilisations', value: `${invite.uses || 0}`, inline: true },
      { name: '📅 Date de suppression', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
    )
    .setTimestamp();
  
  if (invite.inviter) {
    embed.setThumbnail(invite.inviter.displayAvatarURL());
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
