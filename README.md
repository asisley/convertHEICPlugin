# convertHEICPlugin

A local Codex plugin and Mac application for converting HEIC/HEIF photos to JPEG before image analysis.

## Use in Codex

1. Select **@convertHEIC** and send it. The plugin opens its drop zone directly; an image request is optional.
2. Drop photos into the **HEIC Drop Zone** plugin panel. If your host cannot render a local MCP panel, use its native Mac drop window.
3. Conversion happens locally. The JPEGs are added to your unsent chat message. Type your request in the chat bar and press **Send** when ready.

The panel never sends a prompt or starts an assistant turn after conversion. It leaves your draft text alone and uses `ui/update-model-context` for removable JPEG attachments. The panel's Mac drop window follows the same behavior. Hosts must advertise image support for model-context updates; unsupported hosts show a clear message and leave converted JPEGs saved locally.

The plugin does **not** intercept the ordinary Codex composer. A HEIC dropped into that composer can still produce the same error. Use the plugin's drop area or pass the local file path as text.

Opening starts when you send the plugin invocation. Merely selecting the mention in an unsent message does not launch it. Use the live plugin panel; the standalone HTML file is only a development preview.

`~/Applications/convertHEIC.app` also works independently: drop or choose photos, then **Copy JPEGs** and paste them into Codex. **Show JPEGs in Finder** reveals the saved results.

## Behavior

- Up to four HEIC/HEIF photos, 64 MB per photo.
- Original sources are never edited or deleted.
- Full resolution JPEGs are saved to `~/Pictures/convertHEIC` in unique folders; existing outputs are never overwritten.
- Uses `wilsonweightlifting/heic-jpg`, quality 92, with macOS ImageIO as a fallback for unsupported HEIC variants. JPEG is lossy; source metadata and auxiliary HEIC data are not retained.
- Large JPEGs get a smaller inline image for model transport. Full resolution JPEG paths and both dimension sets are returned so Codex can inspect the original resolution when needed.
- HEIC upload tools are marked app-only. Raw HEIC bytes are sent to the local converter, never attached to a model message. Only JPEG image blocks are added to the chat draft; the user controls when to send them.
- There are no network calls, API keys, launch agents, clipboard watchers, or Codex binary patches. Mac app clipboard writes happen only when **Copy JPEGs** is clicked.

## Install / development

Requires Apple Silicon macOS 13+, Node.js 20+, Xcode command-line tools, and a Codex version that supports local plugins and MCP app image context. The conversion server uses only Node's standard library. The bundled CLI is an Apple Silicon binary.

```sh
git clone https://github.com/asisley/convertHEICPlugin.git
cd convertHEICPlugin
bash native/build.sh
codex plugin marketplace add "$PWD"
codex plugin add convert-heic@austin-local-tools
```

Start a new message after installation to reload the plugin. The UI display name is **convertHEIC**; its internal plugin/skill name is **convert-heic**. The generated Mac app is `native/convertHEIC.app`. It is locally ad hoc signed, not a notarized distribution. You can also open that app directly or copy it to `~/Applications`.

For development and verification:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ui
```

The tests generate synthetic HEIC fixtures in temporary directories and clean up afterward. To use an existing Chrome installation for the browser test, run `CONVERTHEIC_BROWSER_CHANNEL=chrome npm run test:ui`. The browser test simulates the MCP host; see `VERIFICATION.md` for the live-test boundary.

## Source layout

- `src/`: converter wrapper, CLI entry point, and local MCP server.
- `ui/`: HEIC drop zone and draft JPEG attachment bridge.
- `native/`: Swift Mac app source, bundle metadata, and build script.
- `skills/`, `.codex-plugin/`, `.mcp.json`, `.agents/plugins/`: Codex skill, plugin, MCP, and local marketplace configuration.
- `tests/`: synthetic fixtures, conversion tests, and browser handoff tests.
- `vendor/heic-jpg/`: complete upstream CLI source, including its tests and MIT license.
- `bin/heic-jpg`: prebuilt CLI used by the plugin.

Converter upstream: [wilsonweightlifting/heic-jpg](https://github.com/wilsonweightlifting/heic-jpg), commit `6553332e47f0ee749985ced96fcce5979e208365`. See `CLI-LICENSE.txt` and `vendor/README.md` for attribution and rebuild instructions. Generated app bundles and personal photos are not included in Git.
