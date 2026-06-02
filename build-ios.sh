#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  YARAM iOS — Build + Archive + Export IPA (script unique)
# ═══════════════════════════════════════════════════════════════════
#
# Usage : depuis ~/Documents/diaara/ exécuter `bash build-ios.sh`
#
# Ce script fait TOUT le pipeline iOS en ligne de commande :
#   1. npm run build (Vite)
#   2. npx cap sync ios
#   3. Cleanup DerivedData + SPM caches
#   4. xcodebuild archive (compile + sign + archive)
#   5. xcodebuild -exportArchive (transforme l'archive en .ipa uploadable)
#
# Le .ipa final est dans ~/Documents/diaara/build/YARAM.ipa
# Ensuite tu peux le drag-and-drop dans Transporter.app (ou Xcode Organizer)
# pour l'uploader sur App Store Connect / TestFlight.
# ═══════════════════════════════════════════════════════════════════

set -e  # stop au moindre échec
cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
ARCHIVE_PATH="$PROJECT_DIR/build/App.xcarchive"
EXPORT_PATH="$PROJECT_DIR/build"
EXPORT_OPTIONS="$PROJECT_DIR/ExportOptions.plist"

echo "═══════════════════════════════════════════════════════════════════"
echo "  YARAM iOS Build Pipeline"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# 0. Install npm packages (au cas où package.json a changé : nouveaux plugins Firebase)
echo "[0/6] 📥 npm install (sync packages)..."
npm install --silent

# 1. Build web
echo ""
echo "[1/6] 📦 Building web bundle (Vite)..."
npm run build

# 2. Sync Capacitor
echo ""
echo "[2/6] 🔁 Syncing iOS project..."
npx cap sync ios

# 3. Cleanup ciblé (uniquement les artefacts du projet, pas les caches Xcode globaux)
echo ""
echo "[3/6] 🧹 Cleaning project artifacts (cleanup ciblé)..."
# Tue d'éventuels xcodebuild zombies d'un run précédent
# (|| true pour éviter exit 1 si rien à tuer — set -e ferait sortir le script)
killall xcodebuild 2>/dev/null || true
killall xcrun 2>/dev/null || true

rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
rm -rf ios/App/.build ios/App/.swiftpm
rm -rf ios/App/CapApp-SPM/.build ios/App/CapApp-SPM/.swiftpm
rm -f ios/App/CapApp-SPM/Package.resolved
rm -rf build/
mkdir -p build

# 4. Resolve SPM (skip explicit step — xcodebuild archive le fera implicitement)
echo ""
echo "[4/6] 📥 SPM resolution → déléguée à xcodebuild archive (étape suivante)"
cd ios/App
CUSTOM_SPM_PATH="$PROJECT_DIR/build/SPM-clones"
mkdir -p "$CUSTOM_SPM_PATH"
echo "    Packages seront clonés dans : $CUSTOM_SPM_PATH"

# 5. Archive (utilise le même chemin SPM pour cohérence)
echo ""
echo "[5/6] 🏗️  Creating archive (5-10 min)..."
xcodebuild archive \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -clonedSourcePackagesDirPath "$CUSTOM_SPM_PATH" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=6779DNV7Y5 \
  2>&1 | grep -E "error:|warning:|^\*\*|ARCHIVE SUCCEEDED|Code signing|provisioning" | head -80

# 6. Export IPA
echo ""
echo "🎁 Exporting IPA from archive..."
cd "$PROJECT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  2>&1 | tail -20

echo ""
echo "═══════════════════════════════════════════════════════════════════"
if [ -f "$EXPORT_PATH/App.ipa" ]; then
  echo "✅ SUCCESS"
  echo ""
  echo "Archive : $ARCHIVE_PATH"
  echo "IPA     : $EXPORT_PATH/App.ipa"
  echo ""
  echo "Next : ouvre Transporter.app, glisse-dépose App.ipa dedans, puis Deliver."
  echo "Ou : open $ARCHIVE_PATH (ouvre Xcode Organizer, clique Distribute App)"
else
  echo "❌ Export IPA failed. Lis les logs ci-dessus pour la cause exacte."
fi
echo "═══════════════════════════════════════════════════════════════════"
