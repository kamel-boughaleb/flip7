/* Flip 7 — Supabase configuration.
 *
 * Remplacez les deux valeurs ci-dessous par celles de VOTRE projet Supabase :
 *   Supabase → Project Settings → API
 *     - "Project URL"          → url
 *     - "Project API keys" → "anon" "public" → anonKey
 *
 * La clé "anon" est conçue pour être publique (elle peut figurer côté client).
 * L'accès est contrôlé par les "policies" RLS de la table `games`
 * (voir les instructions de configuration).
 *
 * Tant que ces valeurs ne sont pas renseignées, l'application fonctionne
 * en local (stockage du navigateur, données NON partagées).
 */
window.FLIP7_CONFIG = {
  url: "https://wpplikcgqfqftsuubbmy.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwcGxpa2NncWZxZnRzdXViYm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTAwNjgsImV4cCI6MjA5NTgyNjA2OH0.Oy51qbfDRctz-YFxvfPqrf0iLEF1m1Y6p574_4Fijgs",
};
