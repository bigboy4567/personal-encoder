# Personal Encoder

Encode un message ou un fichier en signal audio (`.wav`), protégé par une
passphrase, pour que seul quelqu'un disposant de cette passphrase (et de ce
logiciel) puisse le décoder.

**Site : https://bigboy4567.github.io/personal-encoder/**

## Comment ça marche

Tout tourne **entièrement dans le navigateur** — aucun serveur, aucune
donnée envoyée nulle part (à l'exception d'un appel optionnel à l'API
publique CoinGecko pour la génération de passphrase, avec repli automatique
si hors-ligne).

1. **Chiffrement** — AES-256-GCM, clé dérivée par PBKDF2-HMAC-SHA256
   (210 000 itérations) à partir de la passphrase.
2. **Encodage audio** :
   - *Mode texte* — le message chiffré est modulé en tonalités (FSK) selon
     un protocole (fréquences, marqueur de synchronisation) lui-même dérivé
     de la passphrase.
   - *Mode fichier* (jusqu'à 50 Mo) — les octets chiffrés (et compressés en
     gzip si ça réduit la taille) sont écrits directement comme échantillons
     audio bruts : quasi instantané quelle que soit la taille du fichier.
3. **Passphrase générée automatiquement** — un préfixe dérivé du prix du BTC
   (donnée publique, convertie en données à l'aspect aléatoire) combiné à un
   suffixe aléatoire cryptographique, qui constitue la vraie protection. À
   transmettre au destinataire par un canal séparé.

Le décodage détecte automatiquement s'il s'agit d'un texte ou d'un fichier —
pas besoin de préciser le mode.

## Sécurité

- La sécurité repose entièrement sur la passphrase (chiffrement AES-256-GCM
  authentifié) — pas sur le secret du code source, qui est public.
- Le prix du BTC utilisé dans le générateur n'apporte aucune sécurité par
  lui-même : c'est le suffixe aléatoire qui protège le message.
- Une mauvaise passphrase est rejetée proprement (tag d'authentification
  invalide), jamais un décodage silencieusement corrompu.

## Développement

Ce dépôt contient uniquement le site statique publié (HTML/CSS/JS, aucune
dépendance externe). Le projet de développement complet — avec la version
Python équivalente, les tests, et l'outillage — est géré séparément.
