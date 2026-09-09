# Third-party notices and content stance

*[Leia em português](./THIRD-PARTY-NOTICES.md).*

**Sumi hosts, distributes or embeds no manga, extensions or chapters.**
The app ships empty: repositories, sources and library are added by the
user, on their machine. No content traffic passes through our
infrastructure.

## Third-party components (downloaded at runtime, not distributed)

| Component | Role | License | Origin |
|---|---|---|---|
| Suwayomi-Server v2.3.2243 | Local extension engine (sidecar) | MPL-2.0 | https://github.com/Suwayomi/Suwayomi-Server |
| Azul Zulu JRE 25 | Engine Java runtime | Free use (Azul) | https://www.azul.com/downloads/ |
| Chromium (opt-in KCEF) | WebView for Cloudflare sites | BSD-3-Clause (Chromium) | downloaded by the server itself |
| Keiyoushi/Mihon-style extensions | Sources installed by the user | Varies per extension (see each repo) | e.g.: https://github.com/keiyoushi/extensions |
| MangaDex | Native source via public API | (content belongs to respective scanlators/publishers) | https://api.mangadex.org |

Credits: thanks to the Suwayomi, Mihon/Tachiyomi and Keiyoushi projects,
without which this app would not exist. Full upstream credit chain
(TachiWeb, AndroidCompat and others): https://github.com/Suwayomi/Suwayomi-Server
(their README Credit section).

## Copyrighted works

Manga belong to their authors, scanlators and publishers. Sumi is a
reader: if you are a rights holder and believe something here violates
your rights, open an issue and we will respond.

## Non-affiliation

The developer of this application does not have any affiliation with the
content providers available.

## Privacy (no telemetry)

Sumi collects nothing: library, history and settings stay on your
machine. The only network calls the app itself makes are the ones you
trigger (sources, repositories) plus the update check against GitHub
Releases.
