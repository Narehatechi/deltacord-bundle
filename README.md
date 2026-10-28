<p align="center">
  <picture>
    <source
      width="512px"
      media="(prefers-color-scheme: dark)"
      srcset="assets/wordmark/wordmark+slogan-dark.svg"
    >
    <img
      width="512px"
      src="assets/wordmark/wordmark+slogan-light.svg"
    >
  </picture>
  <br>
   <a href="https://github.com/Narehatechi">
       <picture>
           <source height="32px" media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/13122796/178032563-d4e084b7-244e-4358-af50-26bde6dd4996.png" />
           <img height="32px" src="https://user-images.githubusercontent.com/13122796/178032563-d4e084b7-244e-4358-af50-26bde6dd4996.png" />
       </picture>
   </a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
   <a href="https://github.com/Narehatechi">
       <picture>
           <source height="32px" media="(prefers-color-scheme: dark)" srcset="https://i.ibb.co/dMMmCrW/Git-Hub-Mark.png" />
           <img height="32px" src="https://i.ibb.co/9wV3HGF/Git-Hub-Mark-Light.png" />
       </picture>
   </a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;

   </a>
</p>

# 👊 Deltacord

![GitHub Workflow Status (with event)](https://img.shields.io/github/actions/workflow/status/Narehatechi/deltacord-bundle/release.yml)
[![3-Clause BSD License](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/6zm6yY5RrE)

A client modification for Discord on Android and iPhone (beta), forked from [Revenge](https://github.com/revenge-mod) (a continuation of [Bunny](https://github.com/pyoncord/Bunny)), with an Undertale/Deltarune heart.

## 💪 Features

- **🔌 Plugins**: Extend Discord with custom features
- **🎨 Themes & Fonts**: Customize Discord's appearance to your liking
- **🧪 Experiments**: Try out Discord's new features before they're rolled out

### What Deltacord adds

- **Built-in themes**: Deltarune (on by default), Light World and Crimson, which come with the Determination font. Generated on your phone against every colour your Discord version has, so nothing is left Discord-grey, with original pixel-art backdrops.
- **Message logger**: deleted messages stay in red, edits keep their history, and both survive restarts. A searchable **Deleted messages** browser lists everything it caught.
- **Tweaks**: no tracking, hide the gift & apps buttons, hide that you're typing, full timestamps, show hidden channels. Each has its own switch.
- **Backup & restore**: plugins, their settings, themes, fonts and logs in one file; automatic local backups every few days.
- **Crash recovery**: the crash screen names the plugin that crashed and turns it off in one tap; two quick crashes in a row start Deltacord in Safe Mode so you're never locked out.
- **Doctor**: checks versions, updates, theme, plugins and backups, and copies a report.
- **Extras**: optional 8-bit text blips and ★ Saved toasts (original sounds).
- **Keeps up with Revenge**: a daily job brings in Revenge's fixes, renamed for Deltacord, as a pull request.

## ⬇️ Install

> [!WARNING]
> Deltacord is a modified Discord app. Using modified clients is against Discord's Terms of Service. Accounts are very rarely banned for it, but it can happen: use Deltacord at your own risk.

### Android (no root needed)

You need Android 9 or newer. Deltacord installs as its own app next to Discord, so your normal Discord app stays untouched.

1. **Download Deltacord Manager.** On your phone, open the [latest Manager release](https://github.com/Narehatechi/deltacord-manager/releases/latest) and download the file ending in `.apk`.
2. **Install it.** Open the downloaded file. If Android asks, allow your browser (or file manager) to **install unknown apps**, then tap **Install**.
3. **Install Deltacord.** Open **Deltacord Manager** and tap **Install**. It downloads Discord, adds Deltacord to it and installs the result. This takes a minute or two; keep the Manager open until it says **Installed successfully**.
4. **Open Deltacord** (from the Manager's **Launch** button or your app drawer) and log in. Deltacord's intro plays the first time it starts.

**Updating:** Deltacord updates itself when you open it. When the Manager says a new version is available, open it and tap **Update** to get the newest Discord and module.

**If something goes wrong:**
- *"Installation was blocked"* or nothing happens: allow the Manager to install unknown apps (Settings › Apps › Deltacord Manager › Install unknown apps), then try again.
- *"Conflicts with an existing app"*: uninstall the old Deltacord (not your normal Discord) from the Manager's home screen, then install again.
- *Deltacord crashes or won't start*: if it closes twice in a row while opening, the next start is in **Safe Mode** with plugins off, and it tells you which plugin caused it. In Deltacord's settings, **Doctor** checks everything and can copy a report to send in the [Discord server](https://discord.gg/6zm6yY5RrE).

### Android with root (Xposed)

If your phone is rooted with an Xposed framework (LSPosed, [Vector](https://github.com/JingMatrix/Vector)), you can load Deltacord into the official Discord app instead:

1. Download and install the [latest DeltacordXposed module](https://github.com/Narehatechi/deltacord-xposed/releases/latest) (the `app-release.apk`).
2. In your Xposed manager, enable the module for **Discord**.
3. Force-stop Discord and open it again.

### iPhone (beta)

> [!IMPORTANT]
> The iPhone version is a **beta that hasn't been tested on a real iPhone yet**. Some features need the Android module and aren't on iPhone: Typewriter's fast sound player and sound-file import, Deltacord's own image cropper (Discord's own works on iPhone), the startup animation and automatic crash recovery. If something breaks, tell us in the [Discord server](https://discord.gg/6zm6yY5RrE).

You add Deltacord to Discord's app yourself with a sideloading tool, using your own Apple ID. You need:
- A computer (Windows or Mac) with [Sideloadly](https://sideloadly.io), or an on-iPhone signer such as Feather if you have a certificate.
- A **decrypted Discord `.ipa`** file. Deltacord doesn't provide one.
- The Deltacord tweak: from the [latest iPhone release](https://github.com/Narehatechi/deltacord-iphone/releases), download `Deltacord-<version>.deb` (or `Deltacord.dylib` if your tool only takes .dylib files).

**With Sideloadly:**
1. Connect your iPhone to the computer and open Sideloadly.
2. Drag the Discord `.ipa` into Sideloadly and enter your Apple ID.
3. Open **Advanced options**, tick **Inject dylibs/frameworks**, tap **+dylib/deb/bundle** and pick the Deltacord file you downloaded.
4. Press **Start**. If Discord from the App Store is installed, delete it first (your account and servers are safe; they're online), or change the **Bundle ID** in Advanced options to keep both (notifications may not work for the copy with a changed ID).
5. On your iPhone, go to **Settings › General › VPN & Device Management**, tap your Apple ID and **Trust** it. On iOS 16 or newer, also turn on **Settings › Privacy & Security › Developer Mode** when asked.
6. Open Discord and log in. The first start downloads Deltacord, so it can take a few seconds longer.

**Good to know:**
- With a free Apple ID, sideloaded apps stop opening after **7 days**. Run Sideloadly again with the same files to refresh it (your login and settings are kept).
- **Jailbroken?** Install the `.deb` with your package manager (Sileo, Zebra) instead.
- **Recovery menu:** shake your phone for about a second to turn on Safe Mode, reload or pick another Deltacord version, or delete plugins and themes.
- Deltacord updates itself: each start checks for a new version.

## 📚 Everything else

### 📙 Contributing

Thank you for considering contributing to Deltacord.
You can find the contribution guidelines [here](CONTRIBUTING.md).

### 🛠️ Building

To build Deltacord bundle, you can follow the [documentation](/docs).

### 📃 Documentation

You can find the documentation of Deltacord bundle [here](/docs).

## 📜 Licence

Deltacord bundle is licensed under the 3-Clause BSD license. Please see the [license file](LICENSE) for more information.
