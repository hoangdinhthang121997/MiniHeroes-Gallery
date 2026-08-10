# Security and privacy

Hero Gallery's main editor (`START HERE.html`) is designed to run locally. The optional game-import tools are separate and should be treated as an advanced feature.

## Files that should stay private

Do **not** attach these files to public GitHub issues or commit them to the repository:

- `roster.json`
- `hero-gallery-manual-data.json`
- generated `hero-gallery.html` files containing a personal roster
- `discovered-hosts.txt`
- `tools/exporter/.proxy-state.json`
- temporary/legacy certificate files (`*.pem`)

The supplied `.gitignore` excludes the normal generated locations for these files.

## Main editor

The shipped `START HERE.html` and `OPTIONAL - IMPORT FROM GAME/SERVER FIX.html` are self-contained and do not actively load remote scripts/media or upload selected files. The editor uses browser-local state and user-initiated file import/export.

## Optional capture boundary

The normal capture proxy is intentionally narrow:

- the listener binds to the local computer;
- CONNECT is accepted only for the configured Mini Heroes API hostname on port 443;
- other CONNECT destinations are refused;
- the temporary interception certificate is created in memory for the run;
- the emulator's original proxy settings are recorded before modification and checked after restoration;
- `roster.json` contains mapped roster fields rather than captured request headers or the checked `token`, `openId`, and `uid` sign-in fields.

The regional discovery proxy does not decrypt HTTPS. It only allows `maxngame.com` publisher hostnames on port 443 and only forwards them after resolving to a public IPv4 address.

## If a capture is interrupted

Run `OPTIONAL - IMPORT FROM GAME/2 - RESTORE EMULATOR NETWORK.cmd` with the same emulator running. The recovery note is kept until restoration succeeds.

## Reporting a security concern

Do not post private roster/session files publicly. Share the minimum reproducible technical details with the repository owner through an appropriate private channel when possible. Redact account identifiers, tokens, headers, and personal roster data from screenshots/logs.
