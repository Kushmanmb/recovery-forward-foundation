# President Control Center UI

Mobile-friendly interface for the separate `control-center/` Cloudflare Worker application. The UI obtains identity and role information from authenticated server endpoints; it contains no sample applicant, financial, or board data.

- This directory is outside `docs/`, so it is **not** published by GitHub Pages. Do not move it there.
- Do not serve this directory directly with a static development server; the Worker must validate Cloudflare Access identity even for UI assets.
- Deployment and manual security configuration are documented in [`control-center/README.md`](../control-center/README.md).
- Never add passwords, API keys, tokens, or real applicant personal information.
