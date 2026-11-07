import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

describe('Plugin Loading', () => {
    let pluginFiles = [];
    const loadedPlugins = [] = [];
    const errors = [] = [];

    beforeAll(async () => {
        pluginFiles = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
        for (const file of pluginFiles) {
            try {
                const mod = await import(path.join(PLUGINS_DIR, file));
                loadedPlugins.push({ file, mod: mod.default || mod });
            } catch (e) {
                errors.push({ file, error: e.message });
            }
        }
    }, 60000);

    it('has plugins directory', () => expect(fs.existsSync(PLUGINS_DIR)).toBe(true));
    it('has more than 100 plugins', () => expect(pluginFiles.length).toBeGreaterThan(100));

    it('ALL plugins load without errors', () => {
        if (errors.length > 0) console.error('Failed plugins:', errors);
        expect(errors).toEqual([]);
    });

    it('every plugin has a default export', () => {
        const missing = loadedPlugins.filter(p => !p.mod);
        expect(missing.map(p => p.file)).toEqual([]);
    });

    it('every plugin has a command field', () => {
        const missing = loadedPlugins.filter(p => p.mod && !p.mod.command);
        expect(missing.map(p => p.file)).toEqual([]);
    });

    it('every plugin has a handler function', () => {
        const missing = loadedPlugins.filter(p => p.mod?.command && typeof p.mod.handler !== 'function');
        expect(missing.map(p => p.file)).toEqual([]);
    });

    it('viewonce handler responds when no view-once message is quoted', async () => {
        const plugin = loadedPlugins.find(({ mod }) => mod?.command === 'viewonce')?.mod;
        const message = { key: { remoteJid: 'chat@s.whatsapp.net' }, message: {} };
        const sock = { sendMessage: vi.fn().mockResolvedValue(undefined) };

        await plugin.handler(sock, message, [], { chatId: message.key.remoteJid });

        expect(sock.sendMessage).toHaveBeenCalledWith(
            message.key.remoteJid,
            expect.objectContaining({ text: expect.stringContaining('Reply to a *view-once* message') }),
            { quoted: message }
        );
    });

    it('every plugin has a category', () => {
        const missing = loadedPlugins.filter(p => p.mod?.command && !p.mod.category);
        expect(missing.map(p => p.file)).toEqual([]);
    });

    it('every plugin has a description', () => {
        const missing = loadedPlugins.filter(p => p.mod?.command && !p.mod.description);
        expect(missing.map(p => p.file)).toEqual([]);
    });

    it('no duplicate command names', () => {
        const seen = new Map();
        const dupes = [];
        for (const { file, mod } of loadedPlugins) {
            if (!mod?.command) continue;
            if (seen.has(mod.command)) {
                dupes.push(`${file} duplicates '${mod.command}' from ${seen.get(mod.command)}`);
            } else {
                seen.set(mod.command, file);
            }
        }
        expect(dupes).toEqual([]);
    });

    it('no duplicate aliases', () => {
        const seen = new Map();
        const dupes = [];
        for (const { file, mod } of loadedPlugins) {
            for (const alias of mod?.aliases ?? []) {
                const key = alias.toLowerCase();
                if (seen.has(key)) {
                    dupes.push(`${file} duplicates alias '${key}' from ${seen.get(key)}`);
                } else {
                    seen.set(key, file);
                }
            }
        }
        expect(dupes).toEqual([]);
    });

    it('aliases do not shadow command names', () => {
        const commands = new Set(loadedPlugins.map(({ mod }) => mod?.command?.toLowerCase()).filter(Boolean));
        const shadowed = loadedPlugins.flatMap(({ file, mod }) =>
            (mod?.aliases ?? [])
                .filter(alias => commands.has(alias.toLowerCase()))
                .map(alias => `${file} aliases command '${alias}'`)
        );
        expect(shadowed).toEqual([]);
    });

    it('aliases are arrays', () => {
        const invalid = loadedPlugins.filter(p =>
            p.mod?.aliases !== undefined && !Array.isArray(p.mod.aliases)
        );
        expect(invalid.map(p => p.file)).toEqual([]);
    });

    it('ownerOnly/groupOnly/adminOnly are booleans if present', () => {
        const invalid = loadedPlugins.filter(p => {
            const m = p.mod;
            if (!m) return false;
            return (m.ownerOnly !== undefined && typeof m.ownerOnly !== 'boolean') ||
                   (m.groupOnly !== undefined && typeof m.groupOnly !== 'boolean') ||
                   (m.adminOnly !== undefined && typeof m.adminOnly !== 'boolean');
        });
        expect(invalid.map(p => p.file)).toEqual([]);
    });

    it('cooldown is a number if present', () => {
        const invalid = loadedPlugins.filter(p =>
            p.mod?.cooldown !== undefined && typeof p.mod.cooldown !== 'number'
        );
        expect(invalid.map(p => p.file)).toEqual([]);
    });
});
