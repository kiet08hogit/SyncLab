// Fixed so the Playwright config and the global setup agree without sharing
// state. Chosen away from the dev ports (3000 API, 3001 web).
export const WEB_PORT = 3101;
export const API_PORT = 3110;
export const STUB_PORT = 3120;
