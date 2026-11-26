# Reactive Collaborative Pixel Canvas — Frontend

Interface web collaborative temps réel pour la grille géante de 10 000 × 10 000 pixels (clone de Reddit r/place).
Ce composant remplit l'ensemble des exigences du **Chantier Frontend (Epic #114)** et du syllabus `project_steps.pdf` (**C07 §3.1–§3.6**).

---

## 📋 Table des Matières

1. [Démarrage Rapide](#-démarrage-rapide)
2. [Variables d'Environnement](#-variables-denvironnement)
3. [Guide d'Utilisation de l'Interface](#-guide-dutilisation-de-linterface)
   - [HUD Supérieur](#hud-supérieur)
   - [Barre d'Outils Latérale](#barre-doutils-latérale)
   - [Panneau d'Inspection](#panneau-dinspection)
   - [Bannières et Notifications Toast](#bannières-et-notifications-toast)
4. [Modes d'Interaction](#-modes-dinteraction)
   - [Souris & Trackpad](#souris--trackpad)
   - [Raccourcis Clavier Pro](#raccourcis-clavier-pro)
   - [Gestes Tactiles & Mobiles](#gestes-tactiles--mobiles)
5. [Mécanismes & Règles Métier](#-mécanismes--règles-métier)
   - [Réserve de Jetons & Rate Limiting](#réserve-de-jetons--rate-limiting)
   - [Règle de Non-Tronquage des Traits](#règle-de-non-tronquage-des-traits)
   - [Authentification Discord OAuth2](#authentification-discord-oauth2)
   - [Événements Administrateur](#événements-administrateur)
6. [Architecture Technique & Zéro Polling](#-architecture-technique--zéro-polling)
7. [Tests & Qualité](#-tests--qualité)
8. [Déploiement](#-déploiement)

---

## 🚀 Démarrage Rapide

### Prérequis
- Node.js >= 22
- npm >= 10

### Commandes

```bash
# Se placer dans le répertoire du frontend
cd app/frontend

# Installer les dépendances (Vite, TypeScript, Firebase SDK)
npm install

# Lancer le serveur de développement local (avec hot reload)
npm run dev

# Exécuter l'intégralité de la suite de tests unitaires et d'intégration
npm test

# Compiler pour la production (génère les bundles minifiés dans dist/)
npm run build

# Prévisualiser le build de production localement
npm run preview
```

Par défaut, `npm run dev` démarre le serveur sur **`http://localhost:5173`**.

---

## ⚙️ Variables d'Environnement

Un fichier exemple `.env.example` est fourni à la racine de `app/frontend/` :

```env
# Point d'entrée de l'API Gateway (par défaut '/api' pour le proxy local)
VITE_API_GATEWAY_URL=/api

# Client ID de l'application Discord (Discord Developer Portal)
# Si non configuré, le frontend bascule automatiquement sur une identité de simulation locale
VITE_DISCORD_CLIENT_ID=

# Configuration Firebase pour les écouteurs Firestore directs
# Si non configuré, le frontend utilise MockRealtimeProvider en mémoire
VITE_FIREBASE_PROJECT_ID=teampasx-cloudnative-dev
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=teampasx-cloudnative-dev.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=teampasx-cloudnative-dev.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## 🖥️ Guide d'Utilisation de l'Interface

L'interface se compose de quatre zones interactives épurées :

```
+---------------------------------------------------------------------------------------------------------+
| 🎨 Pixel Canvas [10k x 10k] | X: 5420, Y: 120 [📍 Go To] | - 100% + [🎯 Center] | ⚡ 4 tiles | 🪙 20/20 [■] | 🎯 42 px | [⌨️ Help] | [👾 Discord] |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|                                        CANVAS 2D PRINCIPAL                                              |
|                                  (Grille 10 000 x 10 000 pixels)                                        |
|                                                                                                         |
|                                                                                     +-------------------+
|                                                                                     | 🔍 PIXEL INSPECT  |
|                                                                                     | Pos: X 5420, Y 120|
|                                                                                     | Author: Alex#1234 |
|                                                                                     | Time: 12:04:15    |
|                                                                                     | Color: #ff0000    |
|                                                                                     | [✕ Deselect]      |
| +----------------+                                                                  +-------------------+
| | [Radar 10k]    |     +--------------------------------------------------------------------------+     |
| | [Viewport Box] |     | [✏️ Draw] [🔍 Inspect] [💉 Pick] [✋ Pan] | [■ Color] | [1px][3px][5px][9px]     |     |
| +----------------+     | [🧹 Erase] [# Grid] | [📷 Export]                                        |     |
|                        +--------------------------------------------------------------------------+     |
+---------------------------------------------------------------------------------------------------------+
```

### HUD Supérieur
- **Logo & Grille** : Indique la taille globale (`10,000 × 10,000`).
- **Coordonnées (X, Y) & Aller à** : Affiche la position sous le pointeur. Cliquer sur les coordonnées ou sur le bouton `📍 Go To` ouvre un dialogue modal pour naviguer instantanément à n'importe quelle position `(X, Y)` et niveau de zoom.
- **Deep Linking par URL Hash** : L'URL se synchronise automatiquement (`#x=5420&y=120&z=1`). Ouvrir ou partager ce lien centre directement le viewport sur ces coordonnées exactes.
- **Contrôles de Zoom** : Boutons `−`, affichage du pourcentage (de `5%` à `5000%`), bouton `+` et bouton `🎯 Center` pour recentrer le viewport au centre exact (5000, 5000).
- **Badge Live (`⚡ N tiles`)** : Nombre exact de tuiles 64×64 actuellement souscrites via Firestore `onSnapshot`.
- **Réserve de Jetons & Jauge de Recharge (`🪙 N/20`)** : Compteur de jetons disponibles assorti d'une barre de progression de recharge continue (+1 jeton toutes les 3 secondes).
- **Compteur de Contribution (`🎯 N px`)** : Pixels posés par l'utilisateur pendant sa session, persisté dans `localStorage`.
- **Bouton Discord & Raccourcis** :
  - `⌨️ Help` : Ouvre le mémo visuel complet des raccourcis clavier.
  - `Login with Discord` : Redirection OAuth2 officielle (ou profil local de test si non configuré).
  - Connecté : Avatar `👾`, pseudo de l'utilisateur, et bouton de déconnexion `✕`.

### Dock Flottant Inférieur (Tools & Actions)
Inspiré des designs modernes (Figma, Linear) sous forme de dock flottant centré en bas :
- **Outils** :
  - `✏️ Draw` (raccourci <kbd>B</kbd>) : Le clic gauche pose 1 pixel ou 1 trait avec la couleur active.
  - `🔍 Inspect` (raccourci <kbd>V</kbd>) : Le clic gauche inspecte le pixel sans dessiner.
  - `💉 Pick` (raccourci <kbd>I</kbd> ou <kbd>Alt</kbd>+clic) : Pipette prélevant la couleur du pixel cliqué.
  - `✋ Pan` (raccourci <kbd>H</kbd> ou molette / <kbd>Espace</kbd>) : Déplace le canevas au glisser.
- **Palette & Couleurs Récentes** :
  - Bouton couleur active ouvrant le popover de la palette de 16 teintes standards + sélecteur HTML5 `<input type="color">`.
  - Affichage instantané des couleurs récemment utilisées.
- **Taille du Pinceau** :
  - `1px` : 1 pixel par coup (consomme 1 jeton).
  - `3px` : 3×3 pixels, soit 9 pixels par coup (consomme 9 jetons).
  - `5px ⚠️` : 5×5 pixels, soit 25 pixels par coup. Une pastille signale qu'elle dépasse la réserve standard (20 jetons).
  - `9px ⚠️` : 9×9 pixels, soit 81 pixels par coup.
- **Outils Rapides** :
  - `🧹 Erase` (raccourci <kbd>E</kbd>) : Bascule immédiatement sur le blanc d'origine (`#ffffff`).
  - `# Grid` (raccourci <kbd>G</kbd>) : Active/désactive l'affichage de la grille de pixels au zoom ($\ge 8\times$).
  - `📷 Export` : Télécharge instantanément la portion visible du canevas en image PNG locale.

### Radar Minimap (Bas Gauche)
- Affiche en permanence une vue miniature (140×140 px) de l'ensemble de la grille de 10 000 × 10 000 pixels.
- Matérialise les amas de pixels dessinés ainsi que le rectangle englobant du viewport actuel (frustum) surligné en cyan translucide.
- **Navigation Interactive** : Cliquer ou glisser directement sur le radar déplace immédiatement le viewport vers cette zone de la carte.
- **Réductible** : Bouton `▾` permettant d'enrouler ou dérouler le radar à tout moment.

### Panneau d'Inspection (Bas Droite)
Situé en bas à droite, il réagit à l'inspection d'un pixel (via outil `🔍 Inspect`, clic droit ou raccourci <kbd>V</kbd>) :
- **Réticule Cyan (`#06b6d4`)** : Encadre visuellement le pixel inspecté dans le canevas.
- **Position** : Coordonnées globales `X` et `Y`.
- **Auteur** : Identifiant Discord de la dernière personne ayant peint ce pixel, ou `Empty (virgin pixel)` si jamais touché.
- **Date** : Horodatage précis au format local, ou `Never modified`.
- **Couleur** : Aperçu coloré et valeur hexadécimale.
- **Bouton Deselect** : Efface le réticule et réinitialise l'inspecteur.

### Bannières et Notifications Toast
- **Bannière Rouge Pause (`⏸️ Canvas is Paused`)** : Apparaît instantanément en haut de l'écran lors d'une mise en pause administrative via `/admin pause`. Disparaît automatiquement dès la reprise via `/admin resume`.
- **Toasts Anti-Spam & Clignotement Rouge** :
  - Succès de connexion Discord.
  - En cas d'erreurs répétées (jetons épuisés ou taille excessive), les messages d'erreur ne s'empilent pas : un unique toast **reclignote en rouge** (`toast-blink-red`) pendant que la jauge de tokens vibre (`token-battery-shake`).
  - Information lors d'un `/admin clear` ("🧹 Canvas has been reset by an administrator.").

---

## 🎮 Modes d'Interaction

### Souris & Trackpad

| Action | Contrôle |
|---|---|
| **Dessiner** | Clic gauche en mode `✏️ Draw` (strictement 1 pixel par clic à l'enfoncement) |
| **Inspecter un pixel** | Clic droit direct sur le pixel, **OU** Clic gauche en mode `🔍 Inspect` |
| **Pipette (Pick)** | Clic gauche en mode `💉 Pick`, **OU** <kbd>Alt</kbd> + Clic en mode Draw |
| **Déplacer le canevas (Pan)** | Clic & glisser en mode `✋ Pan`, **OU** Clic Molette, **OU** Maintenir `Espace` + glisser |
| **Zoomer / Dézoomer** | Molette de souris (centré sur le curseur) |
| **Changer de couleur** | Clic sur le pastille active pour ouvrir la palette |

> [!NOTE]
> **Zéro action au relâchement** : Tout déclenchement d'action (dessin, pipette, inspection) se produit strictement à l'enfoncement (`mousedown`). Le relâchement du bouton (`mouseup` / `touchend`) ne déclenche aucune action résiduelle et ne fait que restaurer le curseur. Le maintien du clic ne dessine pas en continu pour prévenir tout gaspillage de quota.

### Raccourcis Clavier Pro

| Touche | Action |
|---|---|
| <kbd>B</kbd> | Activer l'outil **Draw** (Brush) |
| <kbd>V</kbd> ou Clic Droit | Activer l'outil **Inspect** / Inspecter un pixel |
| <kbd>I</kbd> ou <kbd>Alt</kbd>+Clic | Activer l'outil **Pick** (Eyedropper / Pipette) |
| <kbd>H</kbd> | Activer l'outil **Pan** (Hand) |
| <kbd>Espace</kbd> *(maintenu)* | Basculer temporairement en mode Pan |
| <kbd>E</kbd> | Gomme rapide (couleur blanche `#ffffff`) |
| <kbd>G</kbd> | Activer / désactiver la grille de pixels |
| <kbd>1</kbd> | Pinceau taille **1px** (1 pixel) |
| <kbd>2</kbd> | Pinceau taille **3px** (9 pixels) |
| <kbd>3</kbd> | Pinceau taille **5px** (25 pixels) |
| <kbd>4</kbd> | Pinceau taille **9px** (81 pixels) |
| <kbd>+</kbd> ou <kbd>=</kbd> | Zoom avant (+25%) |
| <kbd>-</kbd> ou <kbd>_</kbd> | Zoom arrière (-20%) |
| <kbd>0</kbd> ou <kbd>C</kbd> | Recentrer le canevas au milieu (X: 5000, Y: 5000) |
| <kbd>Échap</kbd> | Désélectionner le pixel inspecté / Fermer les modales |

### Gestes Tactiles & Mobiles

L'application est totalement réactive et optimisée pour les écrans tactiles et tablettes :
- **1 doigt en mode Pan** : Glisser pour faire défiler le canevas.
- **1 doigt en mode Draw** : Poser un pixel au toucher (sur appui, pas de rafale au glissé).
- **1 doigt en mode Inspect** : Inspecter le pixel touché.
- **Pincement à 2 doigts (Pinch-to-zoom)** : Zoom avant et zoom arrière fluides centrés sur le point médian entre les deux doigts.
- **Glisser à 2 doigts** : Déplacement simultané du viewport.

---

## 🛡️ Mécanismes & Règles Métier

### Réserve de Jetons & Rate Limiting
- Le canevas implémente un algorithme de **Seau à Jetons (Token Bucket)** :
  - Capacité maximale par défaut : **20 jetons**.
  - Taux de recharge continue : **1 jeton toutes les 3 secondes** (soit 20 jetons par minute).
- Chaque pixel dessiné consomme 1 jeton.
- Le compteur `🪙 N/20` dans le HUD supérieur est synchronisé en temps réel avec le temps écoulé.

### Règle de Non-Tronquage des Traits
Conformément aux critères d'acceptation de l'issue **#83** :
- **Un trait qui dépasse la capacité maximale n'est JAMAIS découpé ni rogné**, car cela déformerait le dessin voulu par l'utilisateur.
- Par exemple, un pinceau de 5px demande 25 pixels, ce qui excède la réserve standard de 20 jetons. Si l'utilisateur clique avec cette taille, l'application bloque le trait et affiche une explication claire :
  > *« Trait supérieur à la capacité maximale (25 pixels > 20 max). Réduisez la taille du pinceau. Le trait n'est pas tronqué pour préserver l'intégrité du dessin. »*

### Authentification Discord OAuth2
1. L'utilisateur clique sur **Connexion Discord**.
2. Un jeton d'état anti-CSRF aléatoire (`csrf_<timestamp>_<hex>`) est enregistré dans `sessionStorage`.
3. L'utilisateur est redirigé vers Discord avec le scope minimal obligatoire : `identify`.
4. À son retour (`?code=...&state=...`), l'état est vérifié strictement.
5. La Cloud Function `auth-callback` échange le code contre le profil Discord et émet un token de session d'1 heure.
6. **Le token d'accès Discord est immédiatement détruit en mémoire côté serveur et n'est jamais persisté.**
7. *(Mode local/dév)* : Si aucun `VITE_DISCORD_CLIENT_ID` n'est configuré, un clic sur le bouton connecte immédiatement un compte Discord simulé (`DiscordUser#XXXX`) pour tester toutes les fonctionnalités sans configuration préalable.

### Événements Administrateur
- **/admin pause** : Reçu via l'écouteur `config/system` de Firestore. Le dessin est suspendu et une bannière rouge s'affiche.
- **/admin resume** : Réactive le dessin et masque la bannière.
- **/admin clear** : Réinitialise instantanément le canevas (`clearAll()`), efface les sélections et affiche une notification informative.

---

## ⚡ Architecture Technique & Zéro Polling

Conformément à **C07 §3.3** et [ADR-0008](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/adr/0008-firestore-listeners-for-realtime.md) :

```
Navigateur Web                                  Google Cloud Platform
+-----------------------+                       +-----------------------------+
| CanvasRenderer (2D)   |                       | Firestore Native Database   |
| Viewport & Culling    | <=== onSnapshot ===== |  - chunks/{chunkId}         |
| RealtimeManager       |      (Zero Polling)   |  - config/system            |
+-----------------------+                       +-----------------------------+
           |
       POST /api/draw (Batch)
           |
           v
+-----------------------+                       +-----------------------------+
| API Gateway           | === Forward (IAM) ==> | Web Draw Proxy (Cloud Fn)   |
+-----------------------+                       +-----------------------------+
                                                               |
                                                          pixel.draw
                                                               v
                                                +-----------------------------+
                                                | Pub/Sub Topic               |
                                                |  'pixel-draw-events'        |
                                                +-----------------------------+
```

1. **ZÉRO Polling** : Aucun appel périodique `setInterval` ni bouton rafraîchir.
2. **Découpage en Tuiles (Chunking 64×64)** :
   - Le viewport calcule dynamiquement la liste des tuiles visibles (`getVisibleChunkIds`).
   - Seules les tuiles visibles sont abonnées via `onSnapshot(doc(firestore, 'chunks', chunkId))`.
   - Dès qu'une tuile sort de l'écran lors d'un déplacement ou d'un zoom, son écouteur est désinscrit immédiatement pour respecter les quotas de connexions.
3. **Zéro Écriture Directe Client** :
   - Les règles de sécurité `firestore.rules` interdisent formellement `write` à tout client.
   - Tout dessin passe par `POST /api/draw` ➔ Cloud Function `web-draw-proxy` ➔ Topic Pub/Sub `pixel-draw-events`.

---

## 🧪 Tests & Qualité

La suite de tests automatisés s'exécute avec le test runner natif de Node.js 22 :

```bash
cd app/frontend
npm test
```

### Couverture des Tests
- `viewport.test.ts` : Mathématiques de projection écran/monde, zoom centré, bornes de la grille.
- `brush.test.ts` : Géométrie des pinceaux (1px, 3px, 5px, 9px), limitation et explications de non-tronquage.
- `canvas.test.ts` : Stockage des métadonnées, sélection et réticule cyan, application de lots, réinitialisation complète (`clearAll`).
- `inspector.test.ts` : Formatage des pixels peints, gestion des pixels vierges, formatage des dates.
- `api.test.ts` : Client Draw API, gestion des erreurs, propagation du jeton d'autorisation.
- `auth.test.ts` : Anti-CSRF state token, flux d'authentification Discord, déconnexion.
- `realtime.test.ts` : Algorithme d'intersection des tuiles visibles, écouteurs sans polling, simulation de dessin distant (bot Discord).
- `rules.test.ts` : Validation de la politique de sécurité `firestore.rules` (lecture authentifiée, rejet de toute écriture client).
- `integration.test.ts` : Cycle de vie complet de bout en bout (tracé, publication, écoute et rendu).

---

## 📦 Déploiement

Le frontend est hébergé de façon 100% serverless sur **Firebase Hosting** avec CDN mondial Google :
- Fichier de configuration : `app/frontend/firebase.json` (site par défaut du projet, `public` = `dist`).
- Routage SPA : Toutes les requêtes `**` sont réécrites vers `/index.html`.
- Politique de cache :
  - Assets compilés et hachés (`/assets/**`) : `public, max-age=31536000, immutable` (mise en cache 1 an).
  - Page d'entrée (`/`, `/index.html` et les routes sans extension) : `no-cache` (revalidée à chaque visite, donc à jour dès un nouveau déploiement).
- Déploiement : automatique à chaque release (tag `vX.Y.Z`), par le workflow `frontend-deploy` après l'apply de la stack serverless. Voir [docs/frontend.md](../../docs/frontend.md#9-build-and-deployment-issue-168).
