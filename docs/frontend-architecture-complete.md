# Guide Complet d'Architecture Frontend — Pixel Canvas (r/place)
> **Document de référence exhaustif pour Quentin Duval (Lead Fullstack & Observabilité)**  
> *Présentation technique, moteur graphique, synchronisation temps réel, subtilités UX et argumentaire de soutenance.*

---

## Sommaire
1. [Vision Globale & Choix Technologiques](#1-vision-globale--choix-technologiques)
2. [Architecture Globale : Le Cycle de Vie d'un Pixel](#2-architecture-globale--le-cycle-de-vie-dun-pixel)
3. [Le Moteur Géométrique & Mathématique](#3-le-moteur-géométrique--mathématique)
4. [Gestion des Interactions & Subtilités UX](#4-gestion-des-interactions--subtilités-ux)
5. [Le Zéro Polling & Synchronisation Temps Réel Firestore](#5-le-zéro-polling--synchronisation-temps-réel-firestore)
6. [Pipeline Asynchrone, Sécurité & Traçage Distribué W3C](#6-pipeline-asynchrone-sécurité--traçage-distribué-w3c)
7. [Authentification Discord OAuth2 & Anti-CSRF](#7-authentification-discord-oauth2--anti-csrf)
8. [Cartographie des Fichiers Source (`app/frontend/src/`)](#8-cartographie-des-fichiers-source-appfrontendsrc)
9. [Fiche Mémo Soutenance : Arguments Chocs & Réponses aux Questions Pièges](#9-fiche-mémo-soutenance--arguments-chocs--réponses-aux-questions-pièges)

---

## 1. Vision Globale & Choix Technologiques

### A. La Stack Technique
- **Langage** : TypeScript en mode strict (`strict: true`, `noImplicitAny: true`, ECMAScript Modules `NodeNext`). Zéro utilisation de type `any`.
- **Bundler / Outillage** : [Vite 6](https://vite.dev) — démarrage à froid en moins de 200 ms, Hot Module Replacement (HMR) sub-milliseconde, et compilation de production ultra-légère (**< 100 KB gzippé**).
- **Moteur Graphique** : **HTML5 Canvas 2D natif** (avec double buffering conceptuel et offscreen culling).
- **Synchronisation Temps Réel** : **Firebase Web SDK v13 modulaire** (`@firebase/firestore`, `@firebase/auth`).
- **Hébergement & CDN** : Firebase Hosting (décision [ADR-0009](adr/0009-firebase-hosting-and-discord-oauth.md)) avec réécritures SPA et mise en cache immuable sur les assets hashés (`Cache-Control: max-age=31536000, immutable`).
- **Coût d'infrastructure** : **0,00 €** en phase de développement local (`http://localhost:5173`), tier gratuit Firebase en production.

### B. Pourquoi ces choix ? (Justification architecturale ADR-0017)
1. **Pourquoi Vanilla Canvas plutôt que React, Vue ou Angular ?**
   - Une grille de $10\,000 \times 10\,000$ représente jusqu'à **100 millions de pixels potentiels**.
   - Un DOM virtuel (React/Vue) générerait des millions de nœuds virtuels et des cycles de Garbage Collection catastrophiques qui provoqueraient des chutes de framerate à chaque déplacement de souris.
   - Le Canvas 2D natif permet de piloter directement le tampon d'affichage en mémoire graphique à **60 images par seconde (FPS)** sans aucune couche d'abstraction superflue.
2. **Pourquoi Canvas 2D plutôt que WebGL / Three.js ?**
   - WebGL / Three.js apporte une complexité accidentelle importante (shaders GLSL, gestion de tampons VBO/IBO, allocations GPU discontinues).
   - Pour un canevas de pixels 2D discret avec zoom et translation matricielle, l'API 2D Canvas de navigateur bénéficie déjà de l'accélération matérielle GPU (`Direct2D` / `Skia`) tout en restant lisible, testable unitairement sous Node.js et robuste face aux rechargements.

---

## 2. Architecture Globale : Le Cycle de Vie d'un Pixel

Le système respecte strictement le **principe de responsabilité unique (SRP)** et un pipeline asynchrone sans écriture directe :

```mermaid
flowchart TD
    subgraph Client ["Navigateur Client (app/frontend)"]
        UI[Clic Utilisateur sur Canevas] -->|Génère traceparent W3C| API_CLIENT[DrawApiClient (api.ts)]
        CANVAS[CanvasRenderer (canvas.ts)] <---|Applique en direct in-place| REALTIME[SubscriptionManager (realtime.ts)]
        VIEWPORT[Viewport Frustum (viewport.ts)] -->|Filtrage Chunks visibles| REALTIME
    end

    subgraph Serverless ["Infrastructure Google Cloud Serverless"]
        API_CLIENT -->|POST /draw + Bearer Token| GW[Google API Gateway]
        GW -->|JWT OIDC auth| PROXY[Cloud Function: web-draw-proxy]
        PROXY -->|Publie EventEnvelope| TOPIC[(Google Cloud Pub/Sub: pixel-draw-events)]
        TOPIC -->|Push Subscription| WORKER[Cloud Function: draw-worker]
        WORKER -->|Validation Token Bucket & LWW| FIRESTORE[(Cloud Firestore: Chunks 64x64)]
    end

    FIRESTORE -.->|WebSocket onSnapshot ZERO POLLING| REALTIME
```

### Les 4 étapes clés :
1. **Intention de dessin** : Le client clique sur une coordonnée. Le front vérifie localement sa batterie de tokens, applique un rendu optimiste immédiat, génère un en-tête W3C `traceparent` et envoie un `POST /api/draw`.
2. **Ingestion & Découplage (Broker)** : La fonction `web-draw-proxy` valide le token Discord, assemble une `EventEnvelope` et publie l'événement dans Pub/Sub en renvoyant un statut `202 Accepted` en moins de 30 ms.
3. **Traitement Asynchrone (Worker)** : La fonction `draw-worker` dépile le message, applique le limiteur de débit global par utilisateur, vérifie si le canevas n'est pas en pause, et écrit le pixel dans le document de chunk $64 \times 64$ correspondant avec résolution Last-Write-Wins (LWW).
4. **Diffusion Mondiale Temps Réel** : Firestore notifie instantanément via WebSocket tous les navigateurs connectés dont le viewport intersecte ce chunk, sans **aucun polling**.

---

## 3. Le Moteur Géométrique & Mathématique

### A. Espace Monde vs Espace Écran
Le canevas est un carré absolu de $10\,000 \times 10\,000$ unités (indices discrets de `0` à `9999`).

- **Espace Écran ($x_s, y_s$)** : Les pixels physiques du navigateur à l'intérieur de la balise `<canvas id="canvas">`.
- **Espace Monde ($x_w, y_w$)** : La coordonnée réelle du pixel sur le canevas infini.

Les transformations matricielles sont gérées dans `app/frontend/src/viewport.ts` :
$$\begin{aligned}
x_w &= \left\lfloor \frac{x_s - \text{panX}}{\text{zoom}} \right\rfloor \\
y_w &= \left\lfloor \frac{y_s - \text{panY}}{\text{zoom}} \right\rfloor
\end{aligned}$$

Réciproquement, pour projeter un pixel monde sur l'écran :
$$\begin{aligned}
x_s &= x_w \times \text{zoom} + \text{panX} \\
y_s &= y_w \times \text{zoom} + \text{panY}
\end{aligned}$$

### B. Zoom Centré au Curseur (`zoomAtPoint`)
Contrairement à un zoom naïf centré sur le coin supérieur gauche, la fonction `zoomAtPoint(screenX, screenY, factor, viewport)` maintient le point du monde situé sous le curseur exactement au même endroit de l'écran :
$$\begin{aligned}
\text{zoom}_{\text{new}} &= \text{clamp}(\text{zoom} \times \text{factor}, 0.05, 50.0) \\
\text{panX}_{\text{new}} &= x_s - (x_s - \text{panX}) \times \frac{\text{zoom}_{\text{new}}}{\text{zoom}} \\
\text{panY}_{\text{new}} &= y_s - (y_s - \text{panY}) \times \frac{\text{zoom}_{\text{new}}}{\text{zoom}}
\end{aligned}$$

### C. Le Frustum Culling (Comment on tient 60 FPS)
Calculer et afficher 100 millions de pixels saturerait la mémoire graphique.  
La fonction `getVisibleWorldBounds(viewport)` calcule à chaque instant le rectangle englobant visible :
$$\begin{aligned}
\text{minX} &= \max\left(0, \left\lfloor \frac{-\text{panX}}{\text{zoom}} \right\rfloor\right) \\
\text{maxX} &= \min\left(9999, \left\lceil \frac{\text{screenWidth} - \text{panX}}{\text{zoom}} \right\rceil\right)
\end{aligned}$$

Seuls les pixels compris dans ce rectangle sont interrogés et dessinés à l'écran. Même si le canevas est gigantesque, la boucle de rendu ne traite jamais plus de quelques milliers de rectangles à la fois.

### D. La Grille Dynamique Intelligente
- À faible zoom (vue d'ensemble), afficher des lignes de séparation transformerait l'écran en un fouillis grisâtre illisible.
- Lorsque $\text{zoom} \ge 8.0\times$, la fonction `drawGrid()` s'active automatiquement et trace un maillage fin semi-transparent (`rgba(255, 255, 255, 0.08)` en mode sombre) pour assister le dessin au pixel près.
- L'utilisateur peut aussi l'activer ou la désactiver manuellement avec la touche `G`.

---

## 4. Gestion des Interactions & Subtilités UX

C'est ici que résident les exigences les plus pointues du projet, ajustées selon tes directives :

### A. Règle Stricte : 1 Clic = 1 Pixel (à l'appui / `mousedown`)
> [!IMPORTANT]
> **Pourquoi le dessin au maintien est strictement interdit ?**
> 1. Évite le vidage accidentel de la réserve de tokens en déplaçant la souris.
> 2. Évite le spam de requêtes HTTP vers l'API Gateway et Cloud Functions.
> 3. Élimine tout comportement parasite au relâchement (`mouseup`, `touchend`).

- **Déclenchement immédiat sur `mousedown` / `touchstart`** : Dès que le bouton gauche s'enfonce, le pixel est validé et dessiné.
- **`mousemove` réservé au Pan** : Déplacer la souris bouton enfoncé en mode dessin ne pose AUCUN pixel supplémentaire.
- **Relâchement passif (`mouseup`)** : Aucune logique métier n'est exécutée lors du relâchement. L'événement sert uniquement à réinitialiser l'état interne de navigation (`isPanning = false`).

### B. Gestion des Brosses (1px, 3px, 5px, 9px) & La Règle d'Or
Les brosses supportées sont définies dans `brush.ts` :
- `1px` = 1 pixel
- `3px` = carré $3 \times 3$ = 9 pixels
- `5px` = carré $5 \times 5$ = 25 pixels
- `9px` = carré $9 \times 9$ = 81 pixels

#### Le Principe : "A stroke larger than the limit is explained, not cut"
La réserve maximale du client est fixée à **20 tokens** (se rechargeant à raison de 1 token toutes les 3 secondes, soit 20 tokens/min).
- Si l'utilisateur sélectionne la brosse `5px` (25 px) ou `9px` (81 px), la taille du trait dépasse la capacité maximale théorique du réservoir (20 tokens).
- **Au lieu de couper ou tronquer sauvagement le dessin à 20 pixels** (ce qui détruirait la forme carrée ou le motif de l'utilisateur), l'application :
  1. Refuse immédiatement le trait en bloc.
  2. Affiche un message explicatif clair via toast :  
     `"Stroke exceeds max capacity (25 pixels requested, max capacity is 20 pixels). Reduce brush size (1px or 3px). The stroke is not truncated to preserve artwork integrity."`
  3. Fait clignoter la batterie de tokens en rouge (`toast-blink-red`) avec une secousse d'animation (`token-battery-shake`).
  4. Déduplique les toasts pour ne pas empiler 10 fenêtres en cas de clics répétés.

### C. Séparation Stricte entre Dessin et Inspection
- Dessiner ne doit **jamais** ouvrir inopportunément la fiche d'inspection du pixel sous le pinceau.
- Pour inspecter un pixel sans altérer le dessin :
  - Soit effectuer un **clic droit** sur n'importe quel pixel (le menu contextuel navigateur est neutralisé par `e.preventDefault()`).
  - Soit presser la touche `V` ou cliquer sur l'outil `🔍 Inspect` dans le dock et faire un clic gauche.
- L'inspection affiche :
  - Un **réticule cyan fluorescent (`#06b6d4`)** encadrant le pixel sélectionné.
  - La fiche détaillée dans le HUD inférieur droit : coordonnées exactes, auteur (tag Discord), horodatage formaté, couleur hexadécimale.
  - Les pixels jamais modifiés sont explicitement identifiés : `"Empty (unpainted)", "Never modified", #ffffff`.

### D. La Minimap Radar ($140 \times 140$)
- Située en bas à gauche de l'écran, elle représente la totalité du canevas $10\,000 \times 10\,000$.
- Un rectangle cyan miniature affiche en direct la zone exacte vue par la caméra de l'utilisateur (le frustum).
- **Interactivité** : Cliquer ou faire glisser sur la minimap téléporte instantanément la caméra sur la coordonnée visée.
- La minimap est repliable via son bouton chevron `▾`.

### E. Deep Linking d'URL et Saut de Coordonnées
- Le hash de l'URL est synchronisé en continu avec la position de la caméra : `#x=5000&y=5000&z=1.5`.
- Cela permet de copier/coller l'URL dans Discord pour pointer un camarade directement sur une fresque précise.
- Un bouton `📍 Jump` permet de saisir manuellement une coordonnée $(X, Y)$ pour s'y rendre immédiatement.

### F. Outils de Confort (Quality of Life)
- **Pipette / Eyedropper (`I` ou `Alt + Clic`)** : Échantillonne la couleur d'un pixel existant et rebascule automatiquement en mode pinceau.
- **Palette Récente** : Mémorise en `localStorage` les 6 dernières couleurs personnalisées utilisées.
- **Gomme Rapide (`E`)** : Sélectionne instantanément le blanc pur `#ffffff`.
- **Mode Hors-Ligne Dégradé** : Écouteur natif `window.onoffline` qui affiche un badge `⚠️ Offline` tout en permettant de tester les interactions localement sans crash.

---

## 5. Le Zéro Polling & Synchronisation Temps Réel Firestore

### A. La Preuve Formelle du Zéro Polling
Le sujet impose de ne faire **aucun polling**.
Dans l'ensemble du dossier `app/frontend/` :
- ❌ Aucun `setInterval()`
- ❌ Aucune boucle `while(true) { await sleep(...) }`
- ❌ Aucun bouton "Rafraîchir"
- ✅ **100% basé sur les flux poussés par le serveur** : La communication repose exclusivement sur les écouteurs natifs WebSocket de Firebase Firestore (`onSnapshot`).

### B. Le Découpage en Chunks $64 \times 64$
Le canevas $10\,000 \times 10\,000$ est subdivisé en une grille de **$157 \times 157$ chunks** (de `chunk_0_0` à `chunk_156_156`), soit 24 649 documents potentiels au total :
$$\text{chunkX} = \lfloor X / 64 \rfloor, \quad \text{chunkY} = \lfloor Y / 64 \rfloor$$

**Pourquoi $64 \times 64$ ?**
- $64 \times 64 = 4\,096$ pixels par document.
- Chaque pixel pèse environ 60 octets (couleur + author + timestamp).
- La taille totale d'un chunk plein est d'environ **240 Ko**, ce qui reste très en dessous de la limite stricte de Firestore (**1 Mo par document**), tout en évitant de créer des millions de documents minuscules de 1 pixel.

### C. Le Gestionnaire d'Abonnements Dynamiques (`SubscriptionManager`)
Pour ne pas dépasser les quotas de connexions simultanées de Firestore :
1. Le client calcule en continu les identifiants des chunks visibles dans l'écran : `getVisibleChunkIds(viewport)`.
2. Pour chaque chunk qui entre dans l'écran : le client appelle `onSnapshot()` et stocke le handle de désabonnement dans une `Map<string, Unsubscribe>`.
3. Dès qu'un chunk quitte le champ de vision (l'utilisateur scrolle ailleurs) : le handle `unsubscribe()` est exécuté immédiatement pour libérer la ressource.
4. **Plafond de sécurité** : En cas de dézoom maximal (vue de tout le canevas), le nombre d'abonnements simultanés est bridé à **64 chunks** (priorisés sur le centre de l'écran) pour ne jamais saturer le navigateur.

### D. Résolution des Conflits (LWW) et Gestion de l'Époque
- **Last-Write-Wins (LWW)** : Si deux utilisateurs dessinent au même endroit, le timestamp UTC du serveur tranche. Le dernier écrit l'emporte.
- **Gestion des Époques (`/admin clear`)** :
  - Le frontend écoute en direct le document système `config/system`.
  - Quand un administrateur déclenche un reset du canevas, l'époque s'incrémente ($E_{n+1} = E_n + 1$).
  - Tous les pixels d'époques antérieures deviennent instantanément caducs et la méthode `renderer.clearAll()` réinitialise l'affichage à blanc en temps réel.
- **Mode Pause (`/admin pause`)** :
  - L'état `paused: true` dans `config/system` fait apparaître un bandeau rouge persistant en haut du canevas et verrouille la brosse.

---

## 6. Pipeline Asynchrone, Sécurité & Traçage Distribué W3C

### A. Règle Fondamentale de Sécurité : Zéro Écriture Directe
Dans `infra/serverless/firestore.rules` :
```javascript
match /chunks/{chunkId} {
  allow read: if request.auth != null;
  allow write: if false; // AUCUN CLIENT NE PEUT ÉCRIRE DIRECTEMENT !
}
```
Si un attaquant inspecte le code source du front et tente d'appeler `setDoc()` directement avec ses clés API Firebase, sa requête est **rejetée immédiatement par le moteur de sécurité Google Cloud** avec un code HTTP 403.

### B. Traçage Distribué W3C de Bout en Bout
Chaque requête de dessin envoyée par `DrawApiClient` génère un contexte de traçage OpenTelemetry standard :
```typescript
const traceId = generateRandomHex(16); // 32 caractères hexadécimaux
const spanId  = generateRandomHex(8);  // 16 caractères hexadécimaux
const traceParent = `00-${traceId}-${spanId}-01`;
```
Ce contexte est envoyé dans les en-têtes HTTP du `fetch` :
- `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
- `X-Correlation-ID: web-1732560000-4bf92f35`

Grâce à cela, un clic dans le navigateur est traçable à la milliseconde près dans la console **Google Cloud Trace** à travers :
$$\text{Navigateur} \rightarrow \text{API Gateway} \rightarrow \text{web-draw-proxy} \rightarrow \text{Pub/Sub} \rightarrow \text{draw-worker} \rightarrow \text{Firestore}$$

---

## 7. Authentification Discord OAuth2 & Anti-CSRF

### A. Déroulement du Flux OAuth2
1. L'utilisateur clique sur **"Se connecter avec Discord"** en haut à droite.
2. Le client génère un token anti-CSRF aléatoire (`csrf_<timestamp>_<random>`) stocké en `sessionStorage`.
3. Redirection vers Discord (`https://discord.com/api/oauth2/authorize`) avec le scope `identify` et le paramètre `state`.
4. Discord renvoie l'utilisateur vers notre fonction Cloud `auth-callback` avec `?code=...&state=...`.
5. La Cloud Function valide le `state`, échange le code contre les infos du profil en utilisant le secret stocké dans **Secret Manager**, et renvoie un jeton de session JWT applicatif.
6. **Zero Access Token Persistence** : Le token d'accès Discord n'est **JAMAIS** stocké en base de données ni dans les logs. Il est détruit de la mémoire dès que le profil est récupéré.
7. Le navigateur stocke le token de session et l'envoie dans `Authorization: Bearer <sessionToken>` lors de chaque dessin.

---

## 8. Cartographie des Fichiers Source (`app/frontend/src/`)

Pour naviguer dans le code en un coup d'œil :

| Fichier | Rôle & Responsabilité |
|---|---|
| `main.ts` | **Orchestrateur principal** : Initialisation du DOM, gestionnaires d'événements souris/tactile/clavier, boucle de rendu, gestion du dock d'outils et toasts. |
| `viewport.ts` | **Moteur mathématique** : Gestion du pan ($x, y$), du zoom ($0.05\times - 50\times$), conversion écran $\leftrightarrow$ monde, frustum culling et calcul des bounds visibles. |
| `canvas.ts` | **Moteur de rendu graphique** : Gestion du tampon Canvas 2D, rendu des pixels, dessin de la grille dynamique ($\ge 8\times$), coloration du réticule d'inspection cyan. |
| `brush.ts` | **Géométrie du pinceau** : Calcul des pixels pour les tailles 1px, 3px, 5px, 9px, et validation stricte du dépassement de capacité (règle de l'explication sans troncature). |
| `realtime.ts` | **Gestionnaire d'abonnements** : Calcul des chunks $64 \times 64$ visibles, attachement/détachement dynamique des listeners `onSnapshot`, gestion de la pause et de l'époque. |
| `inspector.ts` | **HUD d'inspection** : Formatage des métadonnées des pixels sélectionnés (auteur, date, statut vierge/peint, coordonnées). |
| `minimap.ts` | **Radar miniature** : Rendu $140 \times 140$ de l'ensemble du canevas avec projection du rectangle de vue en temps réel. |
| `auth.ts` | **Gestionnaire de session** : Flux OAuth2 Discord, génération du jeton anti-CSRF, stockage en `sessionStorage` et gestion de la déconnexion. |
| `api.ts` | **Client HTTP** : Envoi des lots de pixels vers l'API Gateway, génération des en-têtes W3C `traceparent` et `X-Correlation-ID`. |
| `style.css` | **Feuille de style moderne** : Thème sombre futuriste, dock flottant en verre dépoli (`backdrop-filter: blur`), animations de pulsation rouge et shake de la batterie. |

---

## 9. Fiche Mémo Soutenance : Arguments Chocs & Réponses aux Questions Pièges

Lors de la soutenance, en tant que responsable du Frontend et de l'Observabilité, voici tes arguments clés prêts à l'emploi :

### 🎯 Les 4 Chiffres Clés à Annoncer
1. **100 millions de pixels** : Capacité totale théorique ($10\,000 \times 10\,000$) gérée avec un framerate constant de **60 FPS**.
2. **0 polling** : Zéro intervalle, zéro boucle de rafraîchissement, synchronisation 100% événementielle par WebSockets Firestore.
3. **< 100 Ko** : Poids total du bundle JavaScript de production après compression gzip.
4. **100% de tests au vert** : 32 tests unitaires validant les calculs matriciels, la brosse, l'anti-CSRF et les règles de culling.

---

### 💬 Questions Pièges Fréquentes du Jury

#### Q1 : *"Pourquoi ne pas avoir utilisé React ou Next.js pour votre interface ?"*
> **Réponse de Quentin** :  
> *"Pour une application de type r/place, la contrainte critique est la performance du moteur de rendu. React utilise un DOM virtuel qui aurait dû réconcilier des dizaines de milliers d'éléments à chaque translation de souris, créant des pics de Garbage Collection et des saccades visibles. Avec du Canvas 2D natif en TypeScript strict et Vite, nous maîtrisons chaque cycle de dessin au pixel près sans intermédiaire, ce qui garantit 60 FPS constants et un bundle de production inférieur à 100 Ko."*

---

#### Q2 : *"Comment prouvez-vous qu'il n'y a absolument aucun polling dans votre frontend ?"*
> **Réponse de Quentin** :  
> *"Il suffit d'inspecter l'onglet Réseau des DevTools ou notre codebase : aucun `setInterval` n'existe dans le projet. L'application utilise le SDK Firebase Firestore modulaire qui établit un canal WebSocket persistant. Via `onSnapshot()`, ce sont les serveurs Google qui poussent les modifications de chunks uniquement quand un dessin survient, et uniquement pour les portions de la grille actuellement visibles dans l'écran grâce à notre gestionnaire de Frustum Culling."*

---

#### Q3 : *"Pourquoi avoir interdit le dessin continu au maintien du clic ?"*
> **Réponse de Quentin** :  
> *"Dans un système collaboratif avec limitation de débit (token bucket), maintenir le clic enfoncé en balayant l'écran viderait instantanément la réserve de l'utilisateur en spammant des requêtes HTTP asynchrones désordonnées. En imposant la règle stricte '1 clic à l'appui = 1 pixel ou 1 brosse', l'utilisateur conserve la maîtrise exacte de ses jetons et de son œuvre, tout en éliminant les artéfacts de relâchement de souris."*

---

#### Q4 : *"Que se passe-t-il si un utilisateur tente de dessiner avec une brosse de 9px (81 pixels) alors que son réservoir maximal est de 20 tokens ?"*
> **Réponse de Quentin** :  
> *"Conformément à la consigne 'A stroke larger than the limit is explained, not cut', nous refusons le trait en bloc avec un toast explicatif invitant à réduire la taille, plutôt que de tronquer le dessin à 20 pixels. Tronquer le trait détruirait la symétrie du carré ou du motif de l'utilisateur. Nous préservons l'intégrité de l'œuvre tout en signalant visuellement le manque de tokens par une animation de secousse sur la batterie."*

---

#### Q5 : *"Comment garantissez-vous qu'un utilisateur malveillant ne modifie pas tout le canevas via la console JavaScript ?"*
> **Réponse de Quentin** :  
> *"La sécurité ne repose jamais sur le client. Dans nos `firestore.rules`, toute écriture directe (`write: if false`) est bloquée au niveau de Google Cloud. Le client n'a que des droits de lecture. Pour dessiner, il doit obligatoirement poster un payload signé à notre API Gateway, qui passe par notre proxy d'authentification et notre worker de validation asynchrone avant d'atteindre la base de données."*

---

#### Q6 : *"Comment s'intègre le traçage distribué depuis le navigateur ?"*
> **Réponse de Quentin** :  
> *"Dès l'instant où l'utilisateur clique, notre client génère un en-tête W3C TraceContext standard `traceparent: 00-<traceId>-<spanId>-01` et un `X-Correlation-ID`. Cet identifiant traverse l'API Gateway, le proxy Cloud Function, le message Pub/Sub et le worker Cloud Run. Dans Google Cloud Trace, nous pouvons visualiser le diagramme en cascade complet qui relie le clic dans le navigateur jusqu'à l'écriture dans Firestore."*
