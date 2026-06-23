# Activer "Leaked password protection" (HaveIBeenPwned) — Supabase

P0 #5 de l'audit Yaram du 2026-06-22. **Non automatisable** : Supabase ne
permet pas de toggle ce paramètre via SQL ou via l'API Management. Il faut
ouvrir le dashboard et cliquer.

## Pourquoi

Quand un utilisateur s'inscrit ou change de mot de passe, Supabase peut
interroger l'API HaveIBeenPwned (HIBP) avec un hash partiel et refuser
les mots de passe qui sont déjà connus comme leakés dans des breachs
publics. Sans ça, n'importe quel mot de passe trivial (`123456`,
`password`, `qwerty`...) est accepté — et la liste Top 1M HIBP est
exactement ce que les attaquants essaient en premier (credential
stuffing).

## Comment activer (1 minute)

1. Ouvre [Supabase Dashboard](https://supabase.com/dashboard/) (compte
   propriétaire du projet `qxhhnrnworwrnwmqekmb`).
2. Sélectionne le projet **Yaram**.
3. Sidebar gauche → **Authentication** → onglet **Policies** (ou
   **Sign In / Up** selon la version du dashboard).
4. Section **Password Security** (ou **Password Strength**).
5. Toggle ON **"Prevent the use of leaked passwords"** (libellé exact :
   *"Check passwords against HaveIBeenPwned database"*).
6. Sauvegarde.

## Effets

- À partir du toggle ON, tout nouveau signup ou changement de mot de
  passe via `supabase.auth.signUp` / `supabase.auth.updateUser` est
  validé contre HIBP.
- Les utilisateurs existants ne sont PAS forcés à changer (Supabase ne
  fait pas de re-check rétroactif).
- Si le mot de passe est leaké, l'API renvoie une erreur claire à
  l'utilisateur ("This password has been found in a data breach…").

## À tester après activation

Tente un signup test avec `password` ou `123456789` — Supabase doit
refuser. Tente avec un mot de passe long et original — accepté.

## Lien doc Supabase

- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
