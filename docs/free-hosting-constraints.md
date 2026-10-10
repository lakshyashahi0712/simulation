# Free public-hosting constraints

This is a standing release constraint for every future SENTINEL phase:

> The SIH judge demonstration must be reachable online without paid hosting, a paid domain, paid certificates, or required paid third-party services.

## Primary target

- GitHub Free repository.
- Render Free Docker web service.
- Generated `onrender.com` HTTPS URL.
- One Node.js process serving the built UI, API, and Socket.IO from the same origin.
- Included fictional presets available immediately after a clean deployment.

## Fallback target

- SENTINEL runs on the Windows demonstration laptop.
- Cloudflare Quick Tunnel exposes the local port through a temporary HTTPS URL.
- The laptop must remain awake, connected, and running the server and tunnel.

## Engineering rules

1. Do not require a paid database, paid API, paid domain, or paid certificate.
2. Do not require the project owner to be online for a judge to create a room. The room creator becomes the instructor; the deployed service remains the authoritative backend.
3. Keep the built UI, API, and Socket.IO compatible with one public origin and HTTPS.
4. Treat local JSON persistence as ephemeral on the free deployment. Included presets must work without pre-seeded cloud data.
5. Make cold starts understandable and tolerable; never assume the service is permanently warm.
6. Keep Gemini optional. Local fallback behavior must support the judge flow without an API key.
7. Do not make voice a required judging step. Direct WebRTC may work, but public networks can require TURN, which is outside the zero-cost baseline.
8. Keep memory, CPU, bundle size, and startup work suitable for a free web-service instance.
9. Keep all public demo content fictional and synthetic.
10. Verify changes with the container build path or a clean dependency install, not only the developer’s existing `node_modules`.

## Acceptance definition

The free-hosting phase passes when a new visitor can open the public URL, wait through a possible cold start, create an exercise room, join roles from other browsers, run a preset, and open TruthLens without the owner being present.

See [Public SIH demo deployment](public-demo-deployment.md) and [Phase B evidence sheet](phase-b-evidence.md).
