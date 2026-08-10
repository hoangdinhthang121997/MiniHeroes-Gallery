OPTIONAL - IMPORT MY MINI HEROES COLLECTION

YOU DO NOT NEED THIS FOLDER TO USE HERO GALLERY.
Manual editing in ..\START HERE.html works without Node, ADB, or any capture tool.

USE THIS FOLDER ONLY IF
You want Hero Gallery to fill in many roster values automatically from your own Mini Heroes session.

BEFORE YOU START
You need:
1. Windows.
2. Google Play Games Developer Emulator with Mini Heroes installed and working.
3. Node.js LTS installed.

NORMAL CAPTURE - TRY THIS FIRST
1. Start the emulator and wait for it to be ready.
2. Double-click "1 - CAPTURE MY COLLECTION.cmd".
3. The utility finds the emulator and reopens Mini Heroes if needed.
4. When the Mini Heroes title screen appears, tap Start.
5. Wait until the console says SUCCESS.
6. Open ..\START HERE.html.
7. Choose Import and select roster.json from THIS folder.

If that works, you are done. Do not use Server Fix.

WHAT GETS IMPORTED
When the game supplies the values, the capture can preserve hero level/stars/rarity/power, final Attribute + Attribute Details values, artifacts, Artifact Divinity node levels, gear enhancement, exact gem socket IDs/state, equipped rune IDs, pet assignments, and activated-pet progression.

Hero Gallery combines those account facts with its bundled Mini Heroes 1.25.2 catalogue. Rune-instance IDs show occupied slots, but the tested response does not reliably expose each rune's quality/score/substats. Set Rune Quality Bonus manually after import when needed.

If your roster.json was created by an older extractor, run the current capture again so the expanded Attribute Details fields can be populated.

IF THE NORMAL CAPTURE FAILS BECAUSE OF YOUR REGION
Use Server Fix only when the normal capture times out/refuses the game server because your region uses a different Mini Heroes hostname.

1. Double-click "SERVER FIX.html" and read the guide.
2. Double-click "3 - DISCOVER REGIONAL SERVERS.cmd".
3. When Mini Heroes opens, tap Start and let the 2-minute observation finish.
4. SERVER FIX.html will ask for:
   - discovered-hosts.txt (created in this folder)
   - tools\exporter\proxy.mjs
5. If more than one publisher hostname was observed, try one candidate at a time.
6. Before replacing anything, copy the original tools\exporter\proxy.mjs to tools\exporter\proxy.mjs.bak.
7. Download the fixed proxy.mjs from SERVER FIX.html and place it in tools\exporter\, replacing proxy.mjs.
8. Run "1 - CAPTURE MY COLLECTION.cmd" again.
9. If the candidate does not work, restore proxy.mjs.bak and try another candidate.

Only proxy.mjs should be changed for a regional server. It owns the single API_HOST value used by the exporter, certificate generator, upstream request, and exact CONNECT allowlist. SERVER FIX.html reads the selected files locally as text; it does not execute or upload them.

IF THE EMULATOR INTERNET STOPS WORKING
If Windows or the utility was interrupted while the temporary proxy setting was active:
1. Start the same emulator again.
2. Double-click "2 - RESTORE EMULATOR NETWORK.cmd".
3. The restore tool reads the saved pre-capture proxy values and puts those values back.

SAFETY SUMMARY
- The normal capture listener binds to this computer only.
- The normal capture accepts only the configured Mini Heroes API host on HTTPS port 443. Other CONNECT destinations are refused.
- The regional discovery tool does not decrypt HTTPS or capture account data. It records maxngame.com hostnames only and forwards publisher HTTPS destinations only when they resolve to public IPv4 addresses.
- Request headers are not written to roster.json.
- The exporter checks that token, openId, and uid fields are not written to roster.json.
- The previous emulator proxy values are recorded before the temporary change and restored and verified afterward.
- Generated roster, discovery, recovery, certificate, and common backup files are excluded by the repository .gitignore.

REGION NOTE
The included configuration has been validated only for the supplied US API hostname. Unsupported regional hosts fail closed rather than turning the capture proxy into a general-purpose tunnel.
