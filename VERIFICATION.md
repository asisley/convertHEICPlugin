# Verification — 2026-10-03

Current release: `convert-heic@austin-local-tools`, version 1.0.2.

- A submitted bare `@convertHEIC` invocation opens the drop zone without preliminary questions.
- The panel uses `ui/update-model-context` to stage JPEG image attachments. It contains no `ui/message` or `sendFollowUpMessage` calls, prompt field, or automatic-send option.
- The panel's Mac drop window now waits inside the panel and stages the returned JPEGs without starting an assistant turn.
- The UI resource is versioned as `ui://convertheic/drop-zone-v2.html` to avoid reusing a cached auto-send panel.
- Seven integration tests passed, including panel resource metadata, source preservation, orientation, corrupt inputs, chunk uploads, and cancellation.
- Browser checks passed with real synthetic HEIC conversion and a simulated host: image-only draft content, unchanged composer text, successive drops preserving prior attachments, user removals respected, attachment retry, unsupported-host behavior, and native fallback. No prompt was sent in any case. The native picker was simulated in this browser test.
- Skill validation passed.
- Repository portability checks passed: a clean `npm ci`, all seven integration tests, the browser suite using installed Chrome, and a fresh native Mac app build with code-sign verification. Tests generate their own fixtures and use temporary directories. No personal home paths or credential-like strings were found in the 34-file source package.
- The complete upstream CLI source is retained at the documented commit under `vendor/heic-jpg`; its license matches `CLI-LICENSE.txt`.

The previous 1.0.1 live panel handoff successfully delivered a user-supplied image as a verified 3024 × 4032 JPEG. The 1.0.2 composer staging flow still needs a live drop in Codex to confirm its native attachment display; browser tests simulate the host bridge. Computer Use cannot operate Codex's native composer.

Earlier native checks passed through the actual Mac file picker, including rotated image handoff. The standalone app remains locally ad hoc signed. No ordinary-composer HEIC interception is implemented or claimed.

Bridge references: [OpenAI plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui#manage-state) and [OpenAI MCP extensions](https://developers.openai.com/plugins/build/extensions).
