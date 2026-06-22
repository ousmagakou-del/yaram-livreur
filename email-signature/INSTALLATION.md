# 📧 Installation Signature Email YARAM

## Étape 1 — Ouvre la preview

Double-clique sur `preview.html` pour voir le rendu dans ton navigateur (avec les animations).

## Étape 2 — Récupère le HTML de la signature

Ouvre `yaram-signature.html` dans un éditeur de texte → copie tout le contenu **entre les commentaires de début et de fin**.

## Étape 3 — Installe-la dans ton client mail

### 🍎 Apple Mail (Mac)
1. Ouvre `preview.html` dans Safari
2. **Sélectionne uniquement la signature** (depuis le logo Y jusqu'à la tagline 🌿)
3. Cmd + C
4. Mail → Préférences → Signatures
5. Crée une nouvelle signature, Cmd + V dans la zone de droite
6. Décoche "Toujours utiliser ma police par défaut"

### 📨 Gmail
1. Ouvre `preview.html` dans Chrome
2. Sélectionne la signature (logo Y → tagline 🌿)
3. Cmd/Ctrl + C
4. Gmail → ⚙️ Paramètres → "Voir tous les paramètres"
5. Onglet "Général" → section "Signature"
6. Crée une nouvelle signature → colle (Cmd/Ctrl + V)
7. En bas de page → **Enregistrer les modifications**

### 📧 Outlook
1. Outlook → Préférences → Signatures
2. Nouvelle signature
3. Coller depuis la preview navigateur (même méthode que Gmail)

---

## 🎬 Animation — Ajouter un vrai logo GIF animé

Les clients mail **ne lancent pas les animations CSS**. Pour qu'une animation tourne dans le mail du destinataire, il faut un **GIF**.

### Solution rapide (5 min) :

1. Va sur **ezgif.com/maker** ou **canva.com**
2. Crée un GIF de 90x90px avec :
   - Fond vert YARAM (#1F8B4C → #166635)
   - Lettre "Y" blanche
   - Point orange (#E87722) qui pulse
3. Exporte en GIF (poids < 50 Ko)
4. Héberge-le sur :
   - **yaram.app/signature/logo.gif** (le mieux — domaine maîtrisé)
   - ou imgur.com (gratuit)
5. Dans `yaram-signature.html`, remplace le `<div>` du logo par :

```html
<img src="https://yaram.app/signature/logo.gif" width="90" height="90" alt="YARAM" style="border-radius: 24px; display: block;">
```

---

## 🎨 Personnalisation rapide

Dans `yaram-signature.html`, modifie :

- **Téléphone** : ligne `tel:+221XXXXXXXXX`
- **Email** : `ousmane@yaram.app`
- **Liens App Store** : remplace `https://apps.apple.com/app/yaram` par ton vrai lien
- **Lien Play Store** : remplace `https://play.google.com/store/apps/details?id=app.yaram`

---

## ✅ Tips de pro

- **Garde-la légère** : la signature actuelle pèse < 5 Ko, parfait pour ne pas alourdir tes mails
- **Teste sur mobile** : envoie-toi un mail de test et vérifie sur ton iPhone
- **Le GIF animé** doit faire moins de 50 Ko sinon Gmail le rogne
- **Évite Comic Sans et autres polices fantaisie** : -apple-system / Segoe UI sont compatibles partout
