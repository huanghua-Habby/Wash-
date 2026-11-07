# WASH

Browser multiplayer game with a host authoritative simulation. The Node service serves the client, registers rooms, and relays WebRTC signaling. Gameplay runs in the host browser.

## Local development

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:8080`. To use another port, set `PORT` before starting the service.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Public preview

The single-instance Render configuration is in `render.yaml`. See [public preview deployment](docs/PUBLIC_PREVIEW_DEPLOYMENT.md) for setup and WebRTC connectivity requirements.
