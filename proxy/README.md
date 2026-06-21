# SanitaryFlow AI Proxy

This is the production-safe Anthropic proxy for SanitaryFlow ERP. It keeps the Anthropic API key out of browser JavaScript.

## Local Setup

```bash
cd proxy
copy .env.example .env
npm install
npm run dev
```

Put your rotated Anthropic key in `.env`:

```bash
ANTHROPIC_API_KEY=your_key_here
```

The frontend calls:

```text
http://localhost:8787/api/ai/advisor
```

## Production Setup

Deploy this folder to a Node host such as Render, Railway, Fly.io, DigitalOcean App Platform, or your own VPS.

### Render

This proxy includes `render.yaml` for a Render web service.

1. Push the project to GitHub.
2. In Render, create a new Blueprint or Web Service from the `proxy` folder.
3. Set `ANTHROPIC_API_KEY` in Render's environment variables. Do not paste it into frontend files.
4. Deploy the service.
5. Copy the Render service URL and update the frontend `ai-config.js`:

```js
export const aiConfig = {
  proxyUrl: "https://your-render-service.onrender.com/api/ai/advisor"
};
```

6. Redeploy Firebase Hosting:

```bash
firebase deploy --only hosting
```

Set environment variables in the host dashboard:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `CORS_ORIGINS`
- `REQUIRE_FIREBASE_AUTH`
- `FIREBASE_PROJECT_ID`

After deployment, update `ai-config.js` in the frontend:

```js
export const aiConfig = {
  proxyUrl: "https://your-proxy-domain.example/api/ai/advisor"
};
```

## Security Notes

- Rotate the Anthropic key if it has ever been pasted into chat, source code, or screenshots.
- Keep `.env` out of Git.
- In production, set `REQUIRE_FIREBASE_AUTH=true`.
- When `REQUIRE_FIREBASE_AUTH=true`, configure your host so Firebase Admin can verify ID tokens. The simplest production approach is to provide Google Application Default Credentials or a service account through your hosting provider's secret manager.
