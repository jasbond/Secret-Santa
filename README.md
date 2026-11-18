# 🎅 Père Noël secret

Application web de **Père Noël secret** (Secret Santa) avec **messagerie anonyme** :

- l'organisateur crée un groupe, ajoute les participants et lance le tirage au sort ;
- l'organisateur partage **un seul lien** dans la conversation du groupe (Messenger, WhatsApp…) : chacun appuie sur son prénom, choisit un **code secret** à la première visite, puis découvre à qui il offre un cadeau. Des liens individuels restent disponibles ;
- chacun peut **discuter anonymement** avec la personne à qui il offre (qui ne sait pas qui lui écrit) et avec son propre Père Noël secret (qu'il ne connaît pas) ;
- listes de souhaits (les liens vers des articles en ligne sont cliquables), budget, date, exclusions (ex. : un couple ne se tire pas mutuellement) ;
- **suivi du cadeau** : chacun indique où il en est (je cherche, idée trouvée, acheté, emballé). L'organisateur voit le total des cadeaux prêts ;
- **grande révélation** : à la main, ou automatiquement le lendemain de l'échange (dans le fuseau horaire de l'organisateur, par exemple Tahiti), pour ne pas gâcher la surprise de la soirée.
- **album souvenir** après la révélation : chacun ajoute la photo du cadeau reçu (réduite et débarrassée de ses métadonnées, GPS compris, sur le téléphone) et un petit mot. Chaque carte se télécharge (photo + mot) ; « Tout télécharger » donne un ZIP avec les photos, les mots, une page d'album et les discussions (les siennes pour un participant, toutes avec les prénoms pour l'organisateur) ;
- **compte à rebours** jusqu'à l'échange, **date limite** pour remplir sa liste de souhaits (pastille « Liste vide » et rappel à copier pour l'organisateur), **conseil anti-trahison** à la première discussion. Chacun découvre qui était son Père Noël, puis ouvre les cadeaux un par un pour voir qui offrait à qui.

## Garanties d'anonymat

- Le serveur **ne transmet jamais** l'identité du Père Noël à la personne qui reçoit : ni nom, ni identifiant, ni lien. Ce n'est pas seulement caché à l'écran : l'information n'est jamais envoyée au navigateur (vérifié par les tests automatiques).
- **L'organisateur peut voir qui est le Père Noël de qui**, mais seulement en le demandant (bouton « Voir qui est le Père Noël de qui », avec un avertissement) : s'il participe aussi, il ne se gâche pas la surprise par accident. Il ne peut pas lire les discussions pendant le jeu ; après la révélation, il peut tout télécharger (les participants en sont informés dès leur première visite).
- Chaque page personnelle est protégée par un **code secret** choisi par le participant. Le code est stocké haché avec scrypt. Après 5 erreurs, la page est bloquée 5 minutes, puis 10, puis 20, et ainsi de suite jusqu'à 24 h maximum. À sa connexion, le participant est prévenu du nombre d'essais ratés. Quelqu'un qui récupère le lien d'un autre ne voit rien sans le code.
- **L'organisateur ne peut pas lire les discussions en cachette.** S'il réinitialise le code de quelqu'un pour entrer à sa place, cela laisse une trace impossible à effacer : le participant voit un avertissement (« le code de ce lien a été réinitialisé le … »), et la page organisateur l'affiche aussi. Si l'organisateur ouvrait un lien avant son propriétaire pour y choisir le code, le vrai participant ne pourrait plus entrer sans demander une réinitialisation, et l'avertissement apparaîtrait alors.
- **Révélation transparente** : si l'organisateur révèle les Pères Noël à tout le monde puis les masque à nouveau, une trace datée reste affichée chez tous les participants (qui ont pu les voir entre-temps).
- **Lien ouvert par quelqu'un d'autre** : si un code a été choisi sur un lien avant que son propriétaire ne l'ouvre, l'écran de connexion affiche la date à laquelle ce code a été choisi. Le vrai participant peut ainsi s'en rendre compte.
- **Petits groupes et exclusions** : à 3 participants, chacun peut deviner son Père Noël (c'est forcément la personne à qui il n'offre pas), et l'application le signale avant le tirage. De même, si des exclusions rendent le Père Noël de quelqu'un devinable (par exemple quelqu'un qui n'a plus que deux personnes possibles : il offre à l'une et reçoit de l'autre, ou 4 participants dont un couple exclu), ou obligent deux personnes à s'offrir mutuellement leur cadeau, l'application prévient et demande confirmation.
- En dehors de l'organisateur, seule la personne qui héberge le serveur ou la base de données (par exemple le compte Turso) pourrait techniquement voir le tirage et les messages.

## Lancer en local

Il faut **Node.js 22.13 ou plus récent**. La base SQLite est intégrée à Node ; deux dépendances : `web-push` (notifications) et `@libsql/client` (base Turso, pour l'hébergement gratuit) :

```bash
npm install
```

```bash
npm start
```

Puis ouvrir http://localhost:3000.

```bash
npm test
```

`npm run test:libsql` refait tous les tests avec le client de Turso (libSQL) : une fois sur un fichier temporaire, une fois en ligne face à un faux serveur Turso lancé sur l'ordinateur (pas besoin de compte). Le faux serveur a besoin de Node.js 22.16 ou plus récent (le site, lui, marche dès 22.13).

### Variables d'environnement

| Variable      | Défaut        | Rôle |
|---------------|---------------|------|
| `PORT`        | `3000`        | Port d'écoute |
| `HOST`        | `0.0.0.0`     | Adresse d'écoute |
| `DATA_DIR`    | `./data`      | Dossier de la base SQLite (`secret-santa.sqlite`), quand Turso n'est pas utilisé |
| `TURSO_DATABASE_URL` | (vide) | Adresse de la base Turso (`libsql://…turso.io`). Si elle est donnée, les données sont chez Turso et non dans `DATA_DIR` |
| `TURSO_AUTH_TOKEN`   | (vide) | Jeton d'accès à la base Turso (obligatoire avec `TURSO_DATABASE_URL`) |
| `TURSO_TIMEOUT_MS`   | `15000` | Temps maximal (en millisecondes) d'une requête vers Turso : au-delà, elle est abandonnée pour que le site ne reste pas bloqué |
| `TRUST_PROXY` | `1`           | Mettre `0` si le serveur est exposé directement, sans proxy. Le serveur se fie alors uniquement à la connexion elle-même, et non aux en-têtes `X-Forwarded-Proto` / `X-Forwarded-For` |
| `FORCE_SECURE_COOKIES` | `0`  | Mettre `1` pour toujours marquer les cookies `Secure`, utile si le proxy n'envoie pas `X-Forwarded-Proto` |

## Notifications sur le téléphone

Chacun peut activer, sur sa page, les notifications : nouveau message, tirage, révélation. Elles ne contiennent jamais le texte des messages ni le nom d'un Père Noël.

- Elles passent par les services gratuits des navigateurs (Google, Apple, Mozilla) : **aucun compte à créer**.
- Il faut que le site soit en **HTTPS**.
- Les clés de signature (VAPID) sont générées automatiquement au premier démarrage et **gardées dans la base de données** (elles survivent donc aux redémarrages, même chez un hébergeur sans disque). Un ancien fichier `DATA_DIR/vapid.json` est repris automatiquement. On peut aussi les fournir avec `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`, et indiquer un contact avec `VAPID_SUBJECT` (ex. `mailto:toi@exemple.fr`).
- **iPhone** : il faut d'abord ajouter le site à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis activer les notifications depuis l'appli installée. La page l'explique.
- Le site s'installe aussi comme une appli sur Android et sur ordinateur (icône 🎁).

## Mettre en ligne (pour que tout le monde puisse l'utiliser)

L'application doit tourner sur un serveur accessible en **HTTPS**, et les données doivent être gardées quelque part : soit une **base Turso** (gratuite, en ligne), soit un **disque persistant** pour `DATA_DIR`. Sinon les groupes sont perdus à chaque redémarrage.

### Mettre en ligne gratuitement (Render + Turso)

Tout se fait dans le navigateur, sans carte bancaire ni ligne de commande. **Render** fait tourner le site (gratuitement), **Turso** garde les données (gratuitement). Render efface son disque à chaque redémarrage : c'est pour ça que les données sont chez Turso.

**1. Créer la base de données (Turso)**

1. Aller sur https://turso.tech et cliquer sur **Sign up** (ou **Login**), puis **Continue with GitHub**.
2. Créer une base : bouton **Create Database**. Nom : `pere-noel-secret`. Région : **AWS US West (Oregon)** si elle est proposée (la plus proche de Render et de la Polynésie), sinon la région proposée par défaut. Valider.
3. Sur la page de la base, copier son **adresse** (elle commence par `libsql://` et finit par `.turso.io`). La garder de côté : c'est `TURSO_DATABASE_URL`.
4. Toujours sur la page de la base, créer un **jeton** : bouton **Create Token** (ou **Generate Token**), sans date d'expiration, avec accès en lecture **et écriture** (*read & write*). Copier le long texte qui s'affiche : c'est `TURSO_AUTH_TOKEN`. Il ne s'affiche qu'une fois ; à garder secret, il donne accès à toutes les données.

**2. Mettre le site en ligne (Render)**

1. Aller sur https://render.com et cliquer sur **Get Started** (ou **Sign In**), puis **GitHub**. Autoriser Render à voir le dépôt `jasbond/Secret-Santa`.
2. Dans le tableau de bord : **New +** → **Blueprint**.
3. Choisir le dépôt **jasbond/Secret-Santa**, branche **main**. Render lit le fichier `render.yaml` : un service web gratuit (*Free*) nommé `pere-noel-secret`.
4. Render demande deux valeurs : coller l'adresse Turso dans `TURSO_DATABASE_URL` et le jeton dans `TURSO_AUTH_TOKEN`.
5. Cliquer sur **Deploy Blueprint** (ou **Apply**). La première mise en ligne prend quelques minutes. Quand le service affiche **Live**, son adresse apparaît en haut de la page (du type `https://pere-noel-secret.onrender.com`).

**3. Créer le groupe**

1. Ouvrir l'adresse du site.
2. Sur la page d'accueil, créer le groupe : nom, budget, date, et **coller les 13 prénoms** (un par ligne).
3. Garder précieusement le **lien organisateur** affiché (à mettre en favori), puis partager le lien du groupe dans la conversation.

**Bon à savoir**

- Le site gratuit **s'endort après 15 minutes sans visite**. La visite suivante le réveille : la première page met alors **30 à 60 secondes** à s'afficher, ensuite tout va vite.
- Les données (groupes, codes, messages, photos de l'album, clés des notifications) sont **chez Turso** : elles ne sont perdues ni quand le site s'endort, ni quand Render redémarre ou met à jour le site.
- Chaque modification envoyée sur la branche choisie est mise en ligne automatiquement.
- La personne qui possède le compte Turso peut techniquement lire la base (comme quiconque héberge le serveur) : le tirage et les messages y sont en clair. Ne pas partager le jeton.
- Si le site ne démarre pas, l'onglet **Logs** du service sur Render affiche la raison (adresse ou jeton Turso mal collé, par exemple).

### Avec Docker

```bash
docker build -t pere-noel-secret .
```

```bash
docker run -d --name pere-noel-secret -p 3000:3000 -v pere-noel-data:/data --restart unless-stopped pere-noel-secret
```

À placer derrière un proxy HTTPS (Caddy, Nginx, Traefik…). Le proxy doit transmettre le protocole d'origine, sinon les cookies ne seront pas marqués `Secure`. Avec Nginx :

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Caddy et Traefik envoient ces en-têtes automatiquement. Au démarrage, le conteneur donne lui-même le dossier `/data` à l'utilisateur non privilégié qui fait tourner l'application. Les volumes des hébergeurs, qui appartiennent souvent à root, fonctionnent donc sans réglage.

### Sur une plateforme d'hébergement (Render, Railway, Fly.io…)

1. Créer un service web à partir de ce dépôt (le `Dockerfile` est détecté automatiquement).
2. Ajouter un **volume persistant** monté sur `/data`, ou bien donner `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` (voir ci-dessus) si la plateforme n'offre pas de disque.
3. Le HTTPS est fourni par la plateforme.

Il faut **une seule instance** : la base SQLite est un fichier local, et le serveur ne fait qu'une opération sur la base à la fois.

## Créer le groupe en une commande

Le fichier `groupe.json` contient déjà la liste des participants (Chloe, Cousine Salomé, Dany, Jason, Jessy, Kalea, Kea, Miti, Reva, Salomé J, Salomé M, Veldea, Welma), l'échange le 19 décembre 2026 et la date limite des listes le 29 novembre. Une fois le site en ligne :

```bash
CODE_ORGANISATEUR=123456 npm run creer-groupe -- https://adresse-du-site
```

Remplace `123456` par le code organisateur choisi (4 à 12 chiffres). Il n'est écrit dans aucun fichier du projet. On peut aussi le choisir ou le changer plus tard, dans les paramètres de la page organisateur.

La commande crée le groupe et affiche le lien organisateur et le lien du groupe, à coller dans Messenger. Sur la page « Qui es-tu ? » du lien du groupe, le bouton « 🎩 Je suis l'organisateur » demande le code organisateur et ouvre la page organisateur : l'organisateur n'a besoin que du lien du groupe. Après 5 essais ratés, l'accès est bloqué un moment (5 min, puis 10, 20… jusqu'à 24 h). Il reste ensuite à attendre que tout le monde ait choisi son code, puis à cliquer sur « Lancer le tirage » (tirage entièrement au hasard).

## Architecture

```
src/
  index.js   démarrage du serveur HTTP
  app.js     routes, en-têtes de sécurité, cookies, lecture des requêtes
  store.js   règles métier, validation, contrôle d'accès (requêtes SQL)
  db.js      accès à la base : fichier SQLite (node:sqlite) ou Turso (@libsql/client)
  draw.js    algorithme du tirage (une seule grande chaîne + exclusions)
public/      pages web (HTML/CSS/JS sans framework)
test/        tests automatiques (node --test)
```

- **Tirage** : le tirage forme une seule grande chaîne qui passe par tout le monde (A → B → C → … → A). Ton Père Noël n'est donc jamais la personne à qui tu offres, ce qui garde secrètes les deux discussions anonymes. Sans exclusion, toutes les chaînes sont équiprobables. Avec des exclusions : quelques essais au hasard, puis une recherche systématique avec élagage. Si les exclusions empêchent une chaîne unique, on fait plusieurs cercles d'au moins 3 personnes (jamais d'échange à deux évitable) ; un échange à deux n'est accepté que s'il est inévitable, et l'organisateur est alors prévenu avant le tirage. Si aucun tirage n'est possible, l'application le signale.
- **Limites anti-abus** : 20 créations de groupe par heure et par adresse IP, 30 tentatives de connexion par 10 minutes et par adresse IP, et 10 sessions au maximum par participant.
- **Sécurité** : jetons aléatoires de 144 bits dans les liens, jeton organisateur stocké haché, cookies de session `HttpOnly` + `SameSite=Lax` (+ `Secure` en HTTPS), API exigeant du JSON (protection CSRF), Content-Security-Policy stricte, `Referrer-Policy: no-referrer` pour que les liens secrets ne fuient pas, tout le texte affiché via `textContent` (pas d'injection HTML possible).
- **Messagerie** : rafraîchissement automatique toutes les 4 secondes quand la page est visible.
- **Données personnelles** : uniquement des prénoms, listes de souhaits et messages. L'organisateur peut tout supprimer définitivement (bouton « Supprimer le groupe »). L'annulation du tirage efface toutes les conversations.
