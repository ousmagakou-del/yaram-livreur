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

# 2-bis. PATCH : @capacitor-community/apple-sign-in v7.1.0 a
# `dependencies: capacitor-swift-pm from: "7.0.0"` qui bloque Capacitor 8.
# On élargit la borne max vers <9.0.0 pour rendre le plugin compatible.
# La migration v7→v8 de Capacitor n'a pas de breaking change sur
# AuthenticationServices, donc le code natif Swift continue à fonctionner.
# Idempotent : si déjà patché, le sed ne change rien.
APPLE_SIGNIN_PKG="node_modules/@capacitor-community/apple-sign-in/Package.swift"
if [ -f "$APPLE_SIGNIN_PKG" ]; then
  if grep -q 'capacitor-swift-pm.git", from: "7.0.0"' "$APPLE_SIGNIN_PKG"; then
    echo "    🔧 Patch : apple-sign-in capacitor-swift-pm 7.0.0..<9.0.0 (compat Capacitor 8)"
    # macOS sed : -i '' pour edit in-place sans backup
    sed -i '' 's|capacitor-swift-pm.git", from: "7.0.0"|capacitor-swift-pm.git", "7.0.0"..<"9.0.0"|' "$APPLE_SIGNIN_PKG"
  fi
fi

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

# 4. Resolve SPM EXPLICITEMENT (sinon xcodebuild fail silencieusement avec
#    "Could not resolve package dependencies" sans détail).
echo ""
echo "[4/6] 📥 Resolving SPM packages explicitement..."
cd ios/App
CUSTOM_SPM_PATH="$PROJECT_DIR/build/SPM-clones"
mkdir -p "$CUSTOM_SPM_PATH"

SPM_LOG="$PROJECT_DIR/build/spm-resolve.log"
echo "    Log complet : $SPM_LOG"
set +e
xcodebuild -resolvePackageDependencies \
  -project App.xcodeproj \
  -scheme App \
  -clonedSourcePackagesDirPath "$CUSTOM_SPM_PATH" \
  > "$SPM_LOG" 2>&1
SPM_EXIT=$?
set -e
if [ $SPM_EXIT -ne 0 ]; then
  echo ""
  echo "❌ SPM RESOLVE FAILED (exit=$SPM_EXIT). 60 dernières lignes du log :"
  echo "─────────────────────────────────────────────────────"
  tail -60 "$SPM_LOG"
  echo "─────────────────────────────────────────────────────"
  echo ""
  echo "Causes typiques :"
  echo "  • Pas de connexion internet (Apple GitHub/SPM registry)"
  echo "  • Submodule git fantôme dans build/SPM-clones :"
  echo "    → rm -rf build/SPM-clones && ré-essaie"
  echo "  • Package.resolved corrompu :"
  echo "    → rm ios/App/CapApp-SPM/Package.resolved && ré-essaie"
  echo "  • DerivedData partagé bloqué :"
  echo "    → rm -rf ~/Library/Developer/Xcode/DerivedData/* && ré-essaie"
  echo ""
  echo "Log complet à inspecter : $SPM_LOG"
  exit 1
fi
echo "✅ SPM resolved"

# 5. Archive
echo ""
echo "[5/6] 🏗️  Creating archive (5-10 min)..."
ARCHIVE_LOG="$PROJECT_DIR/build/xcodebuild-archive.log"
echo "    Log complet : $ARCHIVE_LOG"
set +e
xcodebuild archive \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -clonedSourcePackagesDirPath "$CUSTOM_SPM_PATH" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=6779DNV7Y5 \
  > "$ARCHIVE_LOG" 2>&1
ARCHIVE_EXIT=$?
set -e

grep -E "error:|warning:|^\*\*|ARCHIVE SUCCEEDED|Code signing|provisioning" "$ARCHIVE_LOG" | head -50 || true

if [ ! -d "$ARCHIVE_PATH" ]; then
  echo ""
  echo "❌ ARCHIVE FAILED (exit=$ARCHIVE_EXIT). 80 dernières lignes du log :"
  echo "─────────────────────────────────────────────────────"
  tail -80 "$ARCHIVE_LOG"
  echo "─────────────────────────────────────────────────────"
  echo ""
  echo "Log complet à inspecter : $ARCHIVE_LOG"
  exit 1
fi

# 6. Export IPA
echo ""
echo "[6/6] 🎁 Exporting IPA from archive..."
cd "$PROJECT_DIR"
EXPORT_LOG="$PROJECT_DIR/build/xcodebuild-export.log"
set +e
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  > "$EXPORT_LOG" 2>&1
EXPORT_EXIT=$?
set -e

if [ $EXPORT_EXIT -ne 0 ] || [ ! -f "$EXPORT_PATH/App.ipa" ]; then
  echo "❌ EXPORT FAILED (exit=$EXPORT_EXIT). 40 dernières lignes :"
  echo "─────────────────────────────────────────────────────"
  tail -40 "$EXPORT_LOG"
  echo "─────────────────────────────────────────────────────"
  echo "Log complet : $EXPORT_LOG"
  exit 1
fi
tail -10 "$EXPORT_LOG"

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
