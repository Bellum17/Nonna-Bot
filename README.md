# Bot Discord

Un bot Discord simple créé avec Discord.js

## 🚀 Déploiement sur Railway

### Étapes pour déployer :

1. **Créer un compte Railway**
   - Allez sur https://railway.app
   - Connectez-vous avec GitHub

2. **Créer un nouveau projet**
   - Cliquez sur "New Project"
   - Sélectionnez "Deploy from GitHub repo"
   - Autorisez Railway à accéder à votre dépôt GitHub
   - Sélectionnez ce dépôt

3. **Configurer les variables d'environnement**
   - Dans le dashboard Railway, allez dans "Variables"
   - Ajoutez la variable : `DISCORD_TOKEN`
   - Valeur : Votre token Discord

4. **Déployer**
   - Railway déploiera automatiquement votre bot
   - Vérifiez les logs pour confirmer que le bot est connecté

## 📝 Commandes disponibles

- `!ping` - Répond avec "Pong! 🏓"
- `!bonjour` - Salue l'utilisateur
- `!aide` - Affiche la liste des commandes

## 🔧 Installation locale

```bash
npm install
npm start
```

## ⚙️ Configuration

Le bot utilise les intents suivants :
- Guilds
- GuildMessages
- MessageContent

Assurez-vous que ces intents sont activés dans le Discord Developer Portal.
