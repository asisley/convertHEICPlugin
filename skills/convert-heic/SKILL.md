---
name: convert-heic
description: Open the HEIC Drop Zone immediately when the user invokes @convertHEIC, even without a file or image request. Convert HEIC or HEIF photos and stage JPEGs in the unsent chat message without triggering a prompt.
---

# convertHEIC

When the user invokes `@convertHEIC` (including a message containing only the plugin mention), call `open_converter` with `{}` as the first task action after any required account-usage checks. Do not ask for a file path, an image task, or confirmation before opening. Keep the reply to "Drop your HEIC photos here."

The panel converts each drop and uses `ui/update-model-context` to add JPEG image attachments to the chat bar. The user types their request and presses Send. **Do not send a follow-up prompt, start analysis, or ask what to do with the images merely because conversion finished.** The panel must not call `ui/message` or `sendFollowUpMessage`. It does not edit the user's draft text.

Use the live plugin tool. Opening `ui/drop-zone.html` as a browser file displays a disconnected preview. Do not launch a shell helper or poll the model for an in-panel drop. The panel's **Open Mac drop window** button also waits and stages JPEGs itself without starting an assistant turn.

If the user explicitly requests conversion or analysis of existing absolute HEIC paths, use `convert_files`. It returns JPEG image blocks and saved JPEG paths; complete the explicitly requested task using those JPEGs. Keep the user's original request intact. Use the saved full resolution JPEG when details exceed an inline preview.

If the panel cannot render, explain that automatic composer staging requires the plugin panel. The standalone `~/Applications/convertHEIC.app` offers **Copy JPEGs** for manual pasting. Only use `open_mac_drop_window` and `wait_for_drop` directly when the user requests that model-assisted fallback; it returns images to the assistant rather than staging composer attachments. Keep waits at most 30 seconds and honor account-usage cutoff checks. Cancel with `cancel_drop` on stop or cutoff. Do not reopen cancelled sessions automatically.

The plugin cannot intercept HEIC files dropped into the ordinary Codex composer. Selecting the plugin mention does not change accepted formats. Use the panel or an absolute path; never send HEIC originals to image-viewing or model-image tools.

Accept up to four photos per batch, 64 MB each. Originals stay unchanged; full resolution JPEGs are saved under `~/Pictures/convertHEIC`. Large inline JPEGs may be resized for transport. No external conversion service, API key, background watcher, or Codex patch is used. JPEG is lossy and does not preserve all HEIC metadata, depth data, or Live Photo components.
