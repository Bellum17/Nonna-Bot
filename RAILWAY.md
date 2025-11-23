# 🚂 Configuration Railway avec Volume Persistant

## 📦 Étape 1 : Créer un Volume sur Railway

1. **Accédez à votre projet Railway**
   - Allez sur https://railway.app
   - Sélectionnez votre projet de bot Discord

2. **Créer un Volume**
   - Dans l'onglet de votre service, cliquez sur **"Variables"** ou **"Settings"**
   - Cherchez la section **"Volumes"**
   - Cliquez sur **"+ New Volume"**
   - Donnez-lui un nom : `bot-data`

3. **Configurer le Mount Path**
   - Mount Path : `/app/data`
   - Cela créera un dossier persistant dans votre application

## ⚙️ Étape 2 : Ajouter la variable d'environnement

Dans Railway, ajoutez cette variable d'environnement :

```
DATA_DIR=/app/data
```

Cela indique au bot d'utiliser le volume pour sauvegarder la configuration.

## 🚀 Étape 3 : Redéployer

1. Railway redéploiera automatiquement votre bot
2. Le bot créera maintenant `config.json` dans `/app/data/config.json`
3. **Cette configuration sera conservée même après les redémarrages !** 🎉

## ✅ Vérification

Dans les logs Railway, vous devriez voir :
```
📁 Dossier de données: /app/data
📄 Fichier de config: /app/data/config.json
✅ Configuration sauvegardée dans /app/data/config.json
```

## 📝 Utilisation

Après configuration :
1. Utilisez `/setup_log messages #votre-salon` une seule fois
2. Utilisez `/setup_log vocal #votre-salon` une seule fois
3. **Plus besoin de reconfigurer après les redémarrages !** ✨

## � Configuration locale (sans Railway)

Si vous testez en local, le bot utilisera automatiquement le dossier actuel pour `config.json`.

Aucune configuration supplémentaire n'est nécessaire !

## 🆘 Problèmes ?

Si le bot ne sauvegarde toujours pas :
- Vérifiez que le volume est bien créé sur Railway
- Vérifiez que la variable `DATA_DIR=/app/data` est bien définie
- Regardez les logs pour confirmer le chemin utilisé
- Le volume doit être monté sur `/app/data` exactement
