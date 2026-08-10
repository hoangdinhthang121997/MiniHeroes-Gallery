<div align="center">

# Hero Gallery

**An offline Mini Heroes roster editor and Display Case generator.**

Track your collection in a clean local editor, then turn it into a polished, standalone gallery you can keep or share.

![Editor](https://img.shields.io/badge/editor-local%20%26%20offline-2f855a)
![Install](https://img.shields.io/badge/manual%20setup-none-4a5568)
![Import](https://img.shields.io/badge/game%20import-optional-d69e2e)

**[Getting started](#getting-started)** · **[Features](#features)** · **[Optional game import](#optional-game-import)** · **[Troubleshooting](#troubleshooting)** · **[Privacy & backups](#privacy--backups)**

</div>

---

Hero Gallery is a local roster studio for **Mini Heroes**. The main app is a single file — `START HERE.html` — and normal manual use does **not** require installation, Node.js, an emulator, or an internet connection.

## Features

- **Offline roster editor** — add only the heroes you own and record as much or as little detail as you want.
- **Detailed hero records** — track progression, artifacts, gear, gems, runes, pets, talents, final stats, and Attribute Details.
- **Display Case** — preview your collection as a polished gallery and download it as a standalone `hero-gallery.html` file.
- **Light, dark, and system themes** with roster filtering, sorting, comparison, and navigation tools.
- **Editable backups** — save the complete working roster and restore or transfer it later.
- **Optional game-assisted import** — create `roster.json` from your own Mini Heroes session instead of entering many values manually.
- **Bundled catalogue** — the Mini Heroes 1.25.2 catalogue is included so the editor can work completely offline.

## Getting started

### 1. Download and extract

On GitHub, choose **Code → Download ZIP** (or use a release package when one is provided), then **extract the entire folder**.

> Do not run Hero Gallery from inside the ZIP preview.

### 2. Open Hero Gallery

Double-click:

```text
START HERE.html
```

It opens locally in your browser. No installation is required for the editor itself.

### 3. Add your collection

The easiest method is manual editing:

1. Open **Edit roster**.
2. Click `+` on a hero you own.
3. Enter only the details you want Hero Gallery to record.
4. Repeat for the rest of your roster.

That's it. The optional importer is **not required**.

### 4. View or save your Display Case

Open **Display case** to see the gallery version of your roster.

Use **Download display case** to create a standalone `hero-gallery.html` that contains the current gallery locally in one file.

## Two ways to build your roster

| | Manual | Optional game import |
|---|---|---|
| Best for | Most users | Faster initial data entry |
| Setup | None | Windows + [Google Play Games Developer Emulator](https://developer.android.com/games/playgames/emulator) + [Node.js LTS](https://nodejs.org/en/download) |
| Internet needed | No | Editor: no; the game session itself must be online |
| How data is added | You choose each value | Many values are read from your own game session |
| Can edit afterward | Yes | Yes |

**Recommendation:** start manually unless you specifically want automatic collection import.

## Optional game import

The optional tools live in:

```text
OPTIONAL - IMPORT FROM GAME
```

They are separate from the normal Hero Gallery editor and only run when you launch them.

<details>
<summary><strong>Install the optional importer requirements</strong></summary>

### What you need

The optional importer currently targets **Windows** and needs three things:

1. **[Node.js LTS](https://nodejs.org/en/download)**
2. **[Google Play Games on PC Developer Emulator](https://developer.android.com/games/playgames/emulator)**
3. **[Mini Heroes: Magic Throne](https://play.google.com/store/apps/details?id=com.and.brawl.en)** installed and working inside the Developer Emulator

You do **not** need to install npm packages, Android Studio, or a separate copy of ADB for the normal setup. The importer uses only Node.js built-in modules, and Google's Developer Emulator includes a compatible `adb.exe` that Hero Gallery finds automatically.

### 1. Install Node.js LTS

1. Open the official **[Node.js download page](https://nodejs.org/en/download)**.
2. Choose the current **LTS** release for Windows.
3. Run the installer and keep the normal/default options so `node` is added to your PATH.
4. When installation finishes, close and reopen any Command Prompt windows.

Optional check:

```bat
node --version
```

If that prints a version number, Node.js is ready. You do **not** need to run `npm install` for Hero Gallery.

### 2. Install the Google Play Games Developer Emulator

1. Open Google's official **[Developer Emulator download page](https://developer.android.com/games/playgames/emulator)**.
2. Download the **Stable** edition.
3. Run the installer and complete Google's setup.
4. Launch the emulator once and wait for the Android home screen to finish loading.

The Developer Emulator requires Windows virtualization/Hyper-V. If Google reports a virtualization or Hyper-V problem, follow the **[official Microsoft Hyper-V instructions](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v)** and then try the emulator again.

> **ADB is already included.** Google installs a compatible copy with the Developer Emulator, normally under `C:\Program Files\Google\Play Games Developer Emulator\current\emulator\adb.exe`. Hero Gallery checks that location automatically, so a separate Android SDK/Platform-Tools install is normally unnecessary.

Google's own emulator/ADB guide is available here: **[Developing with the Google Play Games on PC Developer Emulator](https://developer.android.com/games/playgames/pg-emulator)**.

### 3. Make sure Mini Heroes works in the emulator

Hero Gallery does not include the Mini Heroes app or an APK. Mini Heroes must already be installed in the Developer Emulator and able to reach the title screen before capture begins.

Official game listing: **[Mini Heroes: Magic Throne on Google Play](https://play.google.com/store/apps/details?id=com.and.brawl.en)**.

Once all three requirements are ready, continue with the import steps below.

</details>

<details>
<summary><strong>Step-by-step collection import</strong></summary>

### Import your collection

1. Start the Google Play Games Developer Emulator and let it finish loading.
2. Make sure Mini Heroes is installed and can open normally.
3. Open `OPTIONAL - IMPORT FROM GAME`.
4. Double-click **`1 - CAPTURE MY COLLECTION.cmd`**.
5. When Mini Heroes reaches the title screen, tap **Start**.
6. Wait until the console says **SUCCESS**.
7. Open `START HERE.html`.
8. Choose **Roster data → Import data** and select the generated `roster.json`.

The imported roster remains fully editable inside Hero Gallery.

### What the importer can preserve

When supplied by the game response, Hero Gallery can preserve hero level, stars, rarity, power, final Attribute and Attribute Details values, artifacts, Artifact Divinity nodes, gear enhancement, gem socket state, equipped rune IDs, pet assignments, and activated-pet progression.

</details>

## Using Hero Gallery

### Save an editable backup

Use:

**Roster data → Download editable backup**

This is the best file for restoring your work later or moving the editable roster to another computer.

### Import existing Hero Gallery data

**Roster data → Import data** accepts supported Hero Gallery roster/backup/display files, including `roster.json` and previously generated Hero Gallery HTML.

### Start over

Use **Roster data → Reset to blank roster** to return all catalogue heroes to an unowned state.

> The included catalogue contains 63 released heroes for Mini Heroes 1.25.2, but your personal roster starts blank.

## Troubleshooting

### `node` is not recognized

Install the current **[Node.js LTS release](https://nodejs.org/en/download)**, keep the installer's default PATH option enabled, then close and reopen Command Prompt before trying the capture again.

### The importer cannot find ADB or the emulator

Make sure the **Google Play Games Developer Emulator** is running and fully loaded. The importer first looks for Google's bundled ADB at:

```text
C:\Program Files\Google\Play Games Developer Emulator\current\emulator\adb.exe
```

If that file is missing, repair or reinstall the **[Developer Emulator](https://developer.android.com/games/playgames/emulator)**. A separate Android Studio installation should not be necessary for the normal setup.

### The optional capture says the regional server is unsupported or refused

Open:

```text
OPTIONAL - IMPORT FROM GAME/SERVER FIX.html
```

Follow the numbered instructions there. Server Fix is only needed when the normal capture cannot use the regional Mini Heroes API hostname.

### The emulator lost internet access after an interrupted capture

Start the same emulator, then double-click:

```text
2 - RESTORE EMULATOR NETWORK.cmd
```

It restores the emulator proxy values saved before capture.

### The capture reached SUCCESS

You're done. **Do not use Server Fix** if the normal capture already succeeded.

<details>
<summary><strong>Rune quality and imported stat notes</strong></summary>

### Rune Quality Bonus

The importer can preserve equipped rune IDs/occupancy, but the tested response does not reliably expose each rune's quality. Set **Rune Quality Bonus** manually when needed.

Mini Heroes activates the set bonus at the **lowest quality among all six equipped runes**.

### Final stats and Attribute Details

Use the final values shown by the game. Those values already include applied rune substats and other bonuses.

If your roster was captured with an older extractor, capture it again with the current importer if you want expanded Attribute Details fields populated when available.

</details>

## Privacy & backups

The main `START HERE.html` editor is self-contained and works locally. It does not actively fetch remote resources, load CDNs, open WebSockets, or upload files you select.

The optional game-import utility is separate and temporarily adjusts the emulator's proxy configuration only while capture is running. It restores the previous settings afterward. Generated roster, discovery, recovery, certificate, and common backup files are excluded by `.gitignore` to reduce the chance of accidentally committing personal files.

For the technical security model and guidance on files that should not be posted publicly, see **[SECURITY.md](SECURITY.md)**.

## Project files

| File / folder | Purpose |
|---|---|
| `START HERE.html` | Main Hero Gallery editor + Display Case |
| `OPTIONAL - IMPORT FROM GAME/` | Optional collection import, recovery, regional discovery, and Server Fix |
| `QUICK START.txt` | Plain-text local quick-start guide |
| `SECURITY.md` | Privacy and security details |
| `LICENSE.txt` | License for original Hero Gallery code/documentation |
| `THIRD_PARTY_NOTICES.txt` | Bundled third-party software notices |
| `DISCLAIMER.txt` | Unofficial-project / third-party-content notice |

## Unofficial project / third-party content

Hero Gallery is an unofficial, non-commercial community project. It is not affiliated with, sponsored by, endorsed by, approved by, or published by MAX GAME PTE. LTD. or other Mini Heroes rights holders.

All game images, screenshots, artwork, names, characters, and other game-related materials are copyright or trademarks of their respective developers, publishers, and rights holders. These materials are used here strictly for review, education, informational reference, personal roster visualization, and community discussion under the principles of fair use where applicable. No ownership of third-party game content is claimed.

See `LICENSE.txt`, `THIRD_PARTY_NOTICES.txt`, and `DISCLAIMER.txt` for additional notices.
