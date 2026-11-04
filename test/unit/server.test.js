import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server;
let attachPairingSocket;
let baseUrl;
const headers = { Authorization: 'Bearer test-pairing-secret' };

beforeAll(async () => {
    process.env.PAIRING_PAGE_PASSWORD = 'test-pairing-secret';
    const pairingServer = await import('../../lib/server.js');
    server = pairingServer.server;
    attachPairingSocket = pairingServer.attachPairingSocket;
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('Pairing page API', () => {
    it('serves the pairing page and protects pairing status', async () => {
        const page = await fetch(baseUrl);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('WhatsApp pairing');

        const unauthorized = await fetch(`${baseUrl}/api/pairing/status`);
        expect(unauthorized.status).toBe(401);

        const authorized = await fetch(`${baseUrl}/api/pairing/status`, { headers });
        expect(authorized.status).toBe(200);
    });

    it('validates phone numbers and returns a formatted pairing code', async () => {
        const invalid = await fetch(`${baseUrl}/api/pairing/code`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: 'not-a-number' })
        });
        expect(invalid.status).toBe(400);

        attachPairingSocket({
            requestPairingCode: async () => 'ABCDEF12'
        }, { registered: false });
        const response = await fetch(`${baseUrl}/api/pairing/code`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: '923001234567' })
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ code: 'ABCD-EF12' });
    });
});
