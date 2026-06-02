# Connecter Flip 7 à Supabase (données partagées)

L'application stocke chaque partie dans une table Supabase. Tant que `config.js`
n'est pas renseigné, elle fonctionne en local (stockage du navigateur).

## 1. Créer un projet Supabase (gratuit)

1. Aller sur https://supabase.com → **Start your project** → se connecter.
2. **New project** : nom, mot de passe de base de données, région proche de vous.
3. Attendre ~1 min que le projet soit prêt.

## 2. Créer la table `games`

Dans le projet : menu de gauche **SQL Editor** → **New query** → coller ceci → **Run** :

```sql
create table if not exists public.games (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table public.games enable row level security;

-- Accès public (lecture/écriture par toute personne ayant l'app).
-- Convient à un tableau de scores entre amis. Pour restreindre, voir plus bas.
create policy "Public read"   on public.games for select using (true);
create policy "Public insert" on public.games for insert with check (true);
create policy "Public update" on public.games for update using (true) with check (true);
create policy "Public delete" on public.games for delete using (true);
```

## 3. Récupérer les clés

Menu **Project Settings** (roue dentée) → **API** :

- **Project URL** → copier
- **Project API keys** → la clé **`anon` / `public`** → copier

## 4. Renseigner `config.js`

Ouvrir `config.js` et remplacer les deux valeurs :

```js
window.FLIP7_CONFIG = {
  url: "https://xxxxxxxxxxxx.supabase.co", // Project URL
  anonKey: "eyJhbGciOiJI...", // clé anon / public
};
```

Recharger la page : la console doit ne plus afficher l'avertissement
« Supabase non configuré », et un bouton **↻ Rafraîchir** apparaît sur l'accueil.

## 5. (Optionnel) Importer les parties déjà saisies en local

Sur la page de l'app (après l'étape 4), ouvrir la console du navigateur et coller :

```js
JSON.parse(localStorage.getItem("flip7_games") || "[]").forEach((g) =>
  db
    .from("games")
    .upsert({ id: g.id, data: g })
    .then(({ error }) => console.log(g.name, error ? error.message : "OK")),
);
```

Recharger : les parties locales sont maintenant dans Supabase, partagées partout.

## 6. Déployer

C'est toujours un site statique → glisser le dossier sur https://app.netlify.com/drop
(ou Cloudflare Pages / Vercel). `config.js` est inclus : la clé `anon` est faite
pour être publique.

---

## Notes

- **Pas de temps réel** : les changements faits sur un autre appareil apparaissent
  après **↻ Rafraîchir** ou un rechargement. (On peut activer le temps réel plus tard.)
- **Sécurité** : les policies ci-dessus laissent quiconque possède l'URL de l'app
  lire/écrire toutes les parties. Pour un usage privé (comptes / connexion), il faut
  ajouter l'authentification Supabase et des policies par utilisateur — me le demander.
