# Defense Team Roles, Speaking Script & Handoff Guide

This guide establishes the speaking schedule, minute-by-minute presentation timeline, screen sharing assignments, vocal handoff cues, and specialized topic ownership for each member of team `teampasx` during the oral defense.

---

## 1. Team Members & Technical Ownership

| Member | Primary Role | Domain Ownership | Key Technical Defenses |
|---|---|---|---|
| **Aurélien Baraquin** (`lechatbleu`) | Architecture & Product Lead | - Discord Bot & Interactions<br>- API Gateway & OpenAPI spec<br>- Pub/Sub broker & DLQ<br>- GitFlow & ADR decisions | - Why asynchronous event-driven proxy?<br>- How Discord Ed25519 verification operates<br>- Why API Gateway as central ingress? |
| **Louis HLT** (`LouisHLT`) | Foundation & Platform Engineer | - Private GKE cluster & VPC topology<br>- Actions Runner Controller (ARC)<br>- Spot VMs & Node Autoscaling<br>- Budget alerts & Cloud FinOps | - Why GKE exclusively for runners?<br>- How runner-pool scales to 0 nodes<br>- How Spot VMs cut costs by up to 90% |
| **Quentin Duval** (`Qua-9-9-1`) | Fullstack & Observability Lead | - Real-time Web Canvas (10k×10k)<br>- Viewport frustum culling & brush<br>- Firestore 64×64 chunking & LWW<br>- W3C OpenTelemetry & Cloud Trace | - How Zero Polling is strictly guaranteed<br>- Why brush strokes are never truncated<br>- How W3C traceparent correlates services |

---

## 2. 20-Minute Defense Timeline (Minute-by-Minute)

```
[00:00 - 02:30] Introduction & Global Architecture -------> Aurélien
[02:30 - 06:30] Foundation & GKE Runner Autoscaling Demo --> Louis
[06:30 - 11:30] Real-Time Web Frontend & Canvas Demo ------> Quentin
[11:30 - 15:30] Discord Bot, Snapshots & Event Pipeline ---> Aurélien
[15:30 - 18:30] Observability, Traces & Burst Load Demo ---> Quentin
[18:30 - 20:00] FinOps, Checklist & Conclusion -----------> Louis
[20:00 - 30:00] Jury Questions & Answers (Q&A) -----------> All Members
```

---

## 3. Speaking Script, Screen Sharing & Transitions

### Act 1: Introduction & System Architecture (00:00 – 02:30)
- **Speaker**: **Aurélien**
- **Screen Sharing**: Slides 1 to 3 ([docs/defense-presentation-slides.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/defense-presentation-slides.md))
- **Verbatim Speech**:
  > *"Bonjour à tous. Nous vous présentons aujourd'hui notre architecture Cloud Native pour le Collaborative Pixel Canvas, un canvas collaboratif temps réel de 10 000 par 10 000 pixels inspiré de r/place.*
  > 
  > *Dès la conception, nous avons fait un choix d'architecture fondamental : une séparation étanche en deux couches :*
  > 1. *Un socle Kubernetes GKE privé, dédié à 100% à l'hébergement de nos runners GitHub Actions éphémères autoscalés. Aucun conteneur applicatif ne tourne sur Kubernetes.*
  > 2. *Une application 100% serverless sur Google Cloud, articulée autour de l'API Gateway, de Cloud Run functions privées, de Cloud Pub/Sub, de Firestore en chunks 64 par 64, et de Cloud Storage.*
  > 
  > *Nous garantissons zéro écriture directe en base, zéro polling sur le front web, et une authentification sans clé grâce à Workload Identity Federation.*
  > *Je passe immédiatement la main à Louis pour vous présenter la fondation et l'autoscaling de nos runners sur GKE."*
- **Transition Cue**: *"Je passe la main à Louis pour la démonstration de la fondation et des runners."*

---

### Act 2: Foundation & GKE Runner Autoscaling (02:30 – 06:30)
- **Speaker**: **Louis**
- **Screen Sharing**: Terminal split (`watch-runner-scaling.sh`) + GCP Console GKE Nodes
- **Verbatim Speech**:
  > *"Merci Aurélien. Côté fondation, notre cluster GKE est privé, situé dans la région europe-west1-b.*
  > 
  > *Regardez sur mon écran : nous avons deux node pools distincts.*
  > *- Le 'system-pool' dispose d'un nœud unique e2-small hébergeant CoreDNS, External Secrets Operator et le contrôleur ARC.*
  > *- Le 'runner-pool' est composé de VMs Spot e2-medium configurées avec un autoscaling de 0 à 2 nœuds. Actuellement, comme aucun pipeline ne tourne, ce pool est à exactement zéro nœud. Nous payons 0 centime de compute pour nos runners quand nous ne construisons rien.*
  > 
  > *Je lance maintenant un job de test de charge sur GitHub Actions avec le label 'runs-on: arc-prd'.*
  > *Observons le terminal : ARC détecte le job et crée un pod éphémère. Ce pod porte la tolérance 'runner=true:NoSchedule'. L'autoscaler GKE détecte le pod en attente et déclenche immédiatement le provisionnement d'un nœud Spot.*
  > 
  > *Enfin, pour l'authentification à GitHub (Issue #151), nous avons remplacé le token personnel par une GitHub App d'organisation. Ses secrets sont stockés dans Secret Manager et répliqués dans Kubernetes par External Secrets Operator via Workload Identity.*
  > 
  > *Je passe maintenant la main à Quentin pour la démonstration du frontend collaboratif en temps réel."*
- **Transition Cue**: *"Je passe la main à Quentin pour le frontend temps réel."*

---

### Act 3: Real-Time Web Frontend & Canvas (06:30 – 11:30)
- **Speaker**: **Quentin**
- **Screen Sharing**: Browser avec le Web Canvas + DevTools Network tab (`F12`)
- **Verbatim Speech**:
  > *"Merci Louis. Passons au front-end web.*
  > 
  > *La consigne C07 §3 impose une contrainte stricte : Zéro Polling. Regardez mon onglet Réseau dans les DevTools : aucun 'setInterval', aucun rechargement régulier, aucun bouton refresh. La synchronisation est 100% événementielle via les listeners natifs 'onSnapshot' de Firestore.*
  > 
  > *Pour afficher une grille de 10 000 par 10 000 pixels — soit 100 millions de pixels — à 60 images par seconde, nous utilisons un moteur HTML5 Canvas doté de Frustum Culling : seuls les chunks visibles dans le viewport actuel sont abonnés et rendus. Quand je me déplace ou dézoome, les chunks hors champ sont automatiquement désabonnés avec unsubscribe().*
  > 
  > *Faisons une démonstration en direct :*
  > 1. *Je sélectionne une couleur et je peins un pixel. Une requête asynchrone HTTP 202 part à l'API Gateway, traverse Pub/Sub, et la mise à jour redescend instantanément sur le stream Firestore.*
  > 2. *J'utilise l'outil Pinceau en taille 5px (25 pixels). Regardez le toast d'erreur : mon quota de tokens étant plafonné à 20, le système refuse le tracé avec un message clair et surtout ne tronque pas le trait, respectant scrupuleusement la règle du sujet pour préserver l'intégrité du dessin.*
  > 3. *J'active la pipette avec la touche I pour capturer une couleur, et la minimap radar me permet de sauter instantanément à n'importe quel quadrant avec synchronisation du hash d'URL.*
  > 
  > *Je rends la main à Aurélien pour vous montrer l'intégration Discord et le pipeline d'événements."*
- **Transition Cue**: *"Je rends la main à Aurélien pour le bot Discord et le pipeline."*

---

### Act 4: Discord Bot, Snapshots & Event Pipeline (11:30 – 15:30)
- **Speaker**: **Aurélien**
- **Screen Sharing**: Discord Client + GCP Console Pub/Sub & Cloud Storage
- **Verbatim Speech**:
  > *"Merci Quentin. Côté Discord, notre bot est 100% serverless : aucun démon discord.js ne tourne en tâche de fond. Nous utilisons exclusivement les Webhooks d'Interactions Discord.*
  > 
  > *Lorsqu'une commande arrive, API Gateway la route vers 'discord-proxy'. La fonction valide la signature cryptographique Ed25519 avec la clé publique du bot. Si la signature est invalide, nous rejetons immédiatement avec HTTP 401.*
  > *Si elle est valide, nous répondons à Discord en moins de 50 millisecondes par un accusé de réception différé (type: 5), évitant le timeout fatidique des 3 secondes de Discord, et nous publions un événement dans Pub/Sub.*
  > 
  > *Démontrons les commandes en direct :*
  > 1. *`/draw x:2000 y:2000 color:#ef4444` applique le pixel de manière asynchrone.*
  > 2. *`/get x:2000 y:2000` inspecte les métadonnées du pixel et renvoie l'auteur et un rendu PNG.*
  > 3. *`/snapshot` : le draw-worker assemble la grille active et dépose un PNG horodaté dans notre bucket Cloud Storage. Le bucket est strictement privé (public access prevention enforced). Le bot répond à l'utilisateur avec une URL signée Google Cloud valide pour exactement 1 heure.*
  > 4. *`/admin clear` : pour réinitialiser la grille en cas d'abus, nous n'effectuons pas une suppression lente et coûteuse de millions de documents. Nous incrémentons l'epoch système dans Firestore en O(1), ce qui invalide instantanément tous les pixels antérieurs.*
  > 
  > *Je repasse la parole à Quentin pour vous montrer l'observabilité et le traçage distribué."*
- **Transition Cue**: *"Je repasse la parole à Quentin pour l'observabilité et les traces."*

---

### Act 5: Observability, Cloud Trace & Burst Load Demo (15:30 – 18:30)
- **Speaker**: **Quentin**
- **Screen Sharing**: GCP Console Cloud Trace Waterfall + Cloud Logging Explorer
- **Verbatim Speech**:
  > *"Merci Aurélien. Pour l'observabilité (C08), nous avons implémenté le standard W3C TraceContext sans aucune dépendance npm lourde, via notre module 'tracer.ts'.*
  > 
  > *Regardez cette trace dans Google Cloud Trace :*
  > *- Le span parent est généré au niveau de l'API Gateway et de web-draw-proxy.*
  > *- L'enveloppe de message Pub/Sub propage le header 'traceparent'.*
  > *- Le draw-worker extrait le span parent, crée un span enfant, et applique la transaction Firestore.*
  > *Tous nos logs Cloud Logging portent l'attribut 'logging.googleapis.com/trace' correspondant, permettant d'accéder d'un clic aux logs complets depuis la vue en cascade.*
  > 
  > *De plus, notre moteur de log structuré masque automatiquement toutes les informations sensibles (tokens OAuth, clés secrètes, signatures Ed25519) par la mention [REDACTED].*
  > 
  > *Enfin, pour prouver la montée en charge, nous avons développé un générateur de charge natif ('tests/load/burst-load.mjs'). En envoyant des rafales de requêtes concurrentes, nous démontrons le bon comportement de la file d'attente Pub/Sub, le déclenchement des seuils HTTP 429 du token bucket, et le maintien d'une latence p95 inférieure à 80 ms.*
  > 
  > *Je passe la parole à Louis pour conclure sur la sécurité, le FinOps et la checklist."*
- **Transition Cue**: *"Je passe la parole à Louis pour la conclusion et la checklist."*

---

### Act 6: FinOps, Checklist & Conclusion (18:30 – 20:00)
- **Speaker**: **Louis**
- **Screen Sharing**: Slide 20 (Scorecard & Checklist) + GCP Billing Console
- **Verbatim Speech**:
  > *"Merci Quentin. Pour conclure sur l'aspect FinOps et gouvernance cloud :*
  > *- Toutes nos alertes de budget GCP sont configurées en Terraform dans la stack 'access' (50%, 90%, 100% spend et prévisionnel).*
  > *- L'utilisation systématique de VMs Spot pour les runners et l'échelle à zéro nous permet de respecter scrupuleusement les crédits alloués.*
  > *- Nous avons consigné dans notre document 'defense-checklist.md' la preuve formelle et vérifiable de chacun des 10 points de la checklist officielle du sujet (§5.6).*
  > 
  > *Nous sommes fiers de vous présenter un système 100% opérationnel, reproductible en Infrastructure as Code, et nous sommes à votre entière disposition pour répondre à toutes vos questions."*

---

## 4. Jury Q&A Strategy & Member Specialization

When the jury asks a question, the corresponding specialist takes the lead:

| Question Category | Primary Respondent | Secondary Support |
|---|---|---|
| **VPC, GKE, Kubernetes, Runners, Helm, Budgets** | **Louis** | Quentin |
| **Discord Bot, API Gateway, Pub/Sub, OpenAPI, GitFlow** | **Aurélien** | Quentin |
| **Frontend Canvas, Viewport, WebSockets, Traces, Firestore Chunks** | **Quentin** | Aurélien |
| **IAM, Security, Workload Identity, Secrets** | **Quentin / Louis** | Aurélien |
