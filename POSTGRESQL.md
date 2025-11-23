# Configuration PostgreSQL pour Railway

## 🗄️ Le bot utilise maintenant PostgreSQL

Le bot sauvegarde maintenant toutes les configurations dans une base de données PostgreSQL au lieu d'un fichier JSON. Cela permet de conserver les paramètres même après un redémarrage sur Railway.

## 🚀 Configuration sur Railway

### 1. Ajouter PostgreSQL à votre projet

Dans Railway :
1. Ouvrez votre projet
2. Cliquez sur **"New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway créera automatiquement la variable `DATABASE_URL`

### 2. Variables d'environnement requises

Railway ajoute automatiquement :
- `DATABASE_URL` - URL de connexion PostgreSQL (ajoutée automatiquement)

Vous devez ajouter manuellement :
- `DISCORD_TOKEN` - Votre token Discord

### 3. Déploiement

Une fois PostgreSQL ajouté :
1. Railway redémarrera automatiquement votre bot
2. Le bot créera automatiquement la table `guild_config`
3. Vos configurations seront maintenant persistantes ! 🎉

## 🔧 Structure de la base de données

```sql
CREATE TABLE guild_config (
  guild_id VARCHAR(255) PRIMARY KEY,
  log_channel_messages VARCHAR(255),
  log_channel_voice VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## 📝 Commandes

- `/setup_log messages #salon` - Configure les logs de messages
- `/setup_log vocal #salon` - Configure les logs vocaux

Les configurations sont maintenant **automatiquement sauvegardées** dans PostgreSQL et **persistent après les redémarrages** ! ✅

## 🧪 Test en local (optionnel)

Pour tester en local avec PostgreSQL :

1. Installez PostgreSQL localement
2. Créez une base de données
3. Ajoutez `DATABASE_URL` dans votre `.env` :
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/discord_bot
   ```

Si `DATABASE_URL` n'est pas défini, le bot fonctionnera quand même mais ne sauvegardera rien (pour les tests rapides).
