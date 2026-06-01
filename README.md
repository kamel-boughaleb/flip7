# Flip 7 — Tableau des scores

Application web (en français) pour tenir les scores du jeu de cartes **Flip 7**
(et de sa variante **Flip 7 : With a Vengeance**).

## Fonctionnalités

- **Lieux** : on choisit un lieu au démarrage ; parties, joueurs et statistiques
  sont liés au lieu sélectionné.
- **Parties** : création rapide (les parties sont nommées automatiquement avec la
  date/heure), ajout des joueurs (nom uniquement).
- **Scores** : tableau récapitulatif (score final par joueur) + écran de détail
  par manche, avec bonus **Flip 7 (+15)** et statut **Éliminé** (0 point).
- **Statistiques** par joueur (parties jouées, points totaux, victoires).
- **Célébration plein écran** aléatoire quand un joueur dépasse 200 points.
- **Règles** intégrées (Flip 7 Classic & Vengeance).
- **Synchronisation** des données entre tous les navigateurs via Supabase
  (rafraîchissement automatique du tableau toutes les 2 s).

## Pile technique

HTML / CSS / JavaScript vanilla, sans build. Persistance partagée via
[Supabase](https://supabase.com) (avec repli sur le stockage local du navigateur
quand Supabase n'est pas configuré).

## Lancer en local

C'est un site statique : servez le dossier, par exemple

```bash
python3 -m http.server 4173
```

puis ouvrez http://localhost:4173

## Configuration Supabase

Renseignez `config.js` (URL du projet + clé `anon`) et créez la table `games`.
Voir [SUPABASE_SETUP.md](SUPABASE_SETUP.md) pour les étapes détaillées.

## Déploiement

Site statique : déployable tel quel sur Netlify, Cloudflare Pages, Vercel, etc.
