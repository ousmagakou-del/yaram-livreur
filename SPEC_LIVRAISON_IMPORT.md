# 🌍 YARAM — Fonctionnalité "Livraison Import 15 jours"

> Modèle : import sur commande (pré-commande internationale).
> Tu listes des produits US/internationaux que tu n'as PAS en stock.
> Le client commande + paie → tu achètes aux US → tu rapatries → tu livres au Sénégal sous ~15 jours.

---

## 1. Le concept en bref

```
1. Tu ajoutes des produits "import" au catalogue (pas en stock chez toi)
2. Le produit affiche "Livraison ~15 jours" au lieu de "J+1 Dakar"
3. Le client commande + PAIE D'AVANCE (pré-paiement obligatoire)
4. Toi → tu achètes le produit aux US
5. Tu le rapatries au Sénégal
6. Tu livres au client (livraison locale séparée du stock Dakar)
```

C'est le modèle des "buying groups" sénégalais et de Shein : tu agrèges les commandes, tu importes, tu livres.

---

## 2. Base de données (migration SQL)

```sql
-- Type de livraison du produit
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'local';
--   'local'  = en stock Dakar, livraison J+1
--   'import' = sur commande internationale, ~15 jours

-- Délai de livraison estimé en jours
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_days INT DEFAULT 1;
--   1  pour local
--   15 (ou 10-20) pour import

-- Pays/source d'origine (optionnel, pour affichage "Importé des USA")
ALTER TABLE products ADD COLUMN IF NOT EXISTS origin_country TEXT;
--   'US', 'FR', 'UK', etc.

-- Index pour filtrer rapidement par type
CREATE INDEX IF NOT EXISTS idx_products_delivery_type ON products(delivery_type);
```

### Sur la table orders (commandes)

```sql
-- Marque si la commande contient au moins un article import
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_import_items BOOLEAN DEFAULT false;

-- Date de livraison estimée pour les imports
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE;
```

---

## 3. Affichage côté client

### Carte produit (Search, Home, Categories)
- Badge **`✈️ Import 15j`** (vs **`⚡ J+1`** pour le local)

### Fiche produit (Product.jsx)
- Encart bien visible :
  > ✈️ **Article importé sur commande**
  > Livraison estimée : **~15 jours ouvrés**
  > Cet article est commandé spécialement pour toi depuis les États-Unis.

### Panier (Cart.jsx)
- Afficher le délai par article : un petit badge sous chaque ligne
- Si panier mixte (local + import) → message clair :
  > 📦 Ta commande contient 2 articles livrés en 24h + 1 article import livré sous ~15 jours.
  > **Ces articles seront livrés séparément.**

### Checkout (Checkout.jsx)
- Récapitulatif des 2 dates de livraison estimées
- Message pré-paiement :
  > ⚠️ Les articles import nécessitent un paiement à la commande.

---

## 4. Décisions business actées

| Sujet | Décision |
|---|---|
| **Paiement import** | Pré-paiement OBLIGATOIRE (le client paie avant que tu achètes) |
| **Livraisons mixtes** | SÉPARÉES : le local part en J+1, l'import sous 15j (2 livraisons) |
| **Délai** | Variable par produit (`delivery_days`), par défaut 15 |
| **Frais d'import** | Inclus dans le prix affiché (transport + douane + marge déjà comptés) |

---

## 5. Workflow admin — nouveaux statuts commande import

Pour les commandes import, étapes supplémentaires dans OrdersSection :

```
Confirmée
  → Payée (pré-paiement reçu)
  → Commandée fournisseur (tu as acheté aux US)
  → En transit international (en route vers le Sénégal)
  → Arrivée au Sénégal (réceptionnée)
  → En livraison locale (le livreur l'a)
  → Livrée
```

(Les commandes locales gardent le flow actuel plus court : Confirmée → En préparation → En livraison → Livrée)

---

## 6. Admin — ajouter/éditer un produit import

Dans ProductsSection (admin), nouveaux champs au formulaire produit :
- Toggle **"Produit import (sur commande)"** → set `delivery_type = 'import'`
- Si activé : champ **"Délai de livraison (jours)"** (défaut 15)
- Champ **"Pays d'origine"** (US / FR / UK...)

---

## 7. Plan d'implémentation (par phases)

### Phase 1 — DB + Admin (1-2h)
- [ ] Migration SQL (delivery_type, delivery_days, origin_country)
- [ ] ProductsSection : toggle import + champs délai/origine
- [ ] PRODUCT_LIST_COLUMNS : ajouter delivery_type, delivery_days

### Phase 2 — Affichage client (2-3h)
- [ ] Badge import sur les cartes produit (composant ProductCard)
- [ ] Encart import sur la fiche produit
- [ ] Délai par article dans le panier
- [ ] Message panier mixte (local + import)

### Phase 3 — Checkout + commande (2-3h)
- [ ] Calcul has_import_items au checkout
- [ ] Affichage 2 dates de livraison estimées
- [ ] Forcer pré-paiement si import (bloquer le paiement à la livraison)
- [ ] Stocker estimated_delivery_date sur la commande

### Phase 4 — Admin commandes (1-2h)
- [ ] Statuts spécifiques import dans OrdersSection
- [ ] Filtre "Commandes import" dans l'admin
- [ ] Push/WhatsApp auto à chaque étape (système déjà existant)

### Phase 5 — Polish (1h)
- [ ] Filtre "Import" / "Disponible maintenant" dans Search
- [ ] Page d'explication "Comment marche l'import YARAM ?"

**Total estimé : 8-12h de dev** réparties sur quelques sessions.

---

## 8. Points d'attention / risques

- **Trésorerie** : tu reçois le pré-paiement client, mais tu avances le coût d'achat US. Calcule ta marge en incluant transport + douane.
- **Annulations** : le pré-paiement protège, mais prévois une politique de remboursement claire si tu ne peux pas approvisionner.
- **Délais variables** : 15 jours est une estimation. Mets une marge ("~15-20 jours") pour ne pas décevoir.
- **Douane Sénégal** : selon la valeur, des frais de douane peuvent s'appliquer à l'import. À intégrer dans ton pricing.
- **Communication** : le client doit COMPRENDRE qu'il commande un import (pas un produit en stock). D'où l'importance des badges + messages clairs.

---

*Document de conception — YARAM Import 15j. À implémenter quand le push iOS/Android sera réglé et l'app Android publiée.*
