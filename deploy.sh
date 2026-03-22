#!/bin/bash
echo "🚀 Démarrage de la construction du Shard..."

# 1. On nettoie si un ancien build existe
rm -rf .shard-build
rm -f deploy.zip
mkdir .shard-build

# 2. On Build le Frontend (Client)
echo "📦 Build du Frontend..."
cd client
npm install
npm run build
# On copie le contenu du dist dans notre dossier final
cp -R dist/* ../.shard-build/
cd ..

# 3. On copie le Backend (Server) sans les node_modules
echo "⚙️ Copie du Backend..."
rsync -av --exclude='node_modules' --exclude='.env' --exclude='shards_storage' server/ .shard-build/

# 4. On crée le fichier .zip final
echo "🗜️ Création du fichier deploy.zip..."
cd .shard-build
zip -r ../deploy.zip . -x "*.DS_Store"
cd ..

# 5. On nettoie le dossier temporaire
rm -rf .shard-build

echo "✅ Terminé ! Ton fichier 'deploy.zip' est prêt à être envoyé sur Stardust 🚀"
