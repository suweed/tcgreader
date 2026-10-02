#!/usr/bin/env node
/**
 * import_cards_postgres.js
 * Imports One Piece TCG data from punk-records (English + Japanese)
 * directly into the PostgreSQL database (Neon / Vercel Postgres).
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/import_cards_postgres.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const PUNK_ROOT = path.join(__dirname, '../data/punk-records');
const LANGUAGES = ['english', 'japanese'];
const LANG_CODE_MAP = { english: 'en', japanese: 'jp' };

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
    console.error('\n❌ ERROR: Falta DATABASE_URL.');
    console.error('Ejemplo: DATABASE_URL="postgres://..." node scripts/import_cards_postgres.js\n');
    process.exit(1);
}

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}

function safeArr(val) {
    if (Array.isArray(val)) return JSON.stringify(val);
    if (val != null) return JSON.stringify([val]);
    return '[]';
}

function safeInt(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
}

function getPackCode(pack) {
    let code = pack.title_parts?.label;
    if (!code && pack.raw_title) {
        const m = pack.raw_title.match(/【([A-Z0-9]+)-([0-9]+)】/i);
        if (m) code = m[1] + m[2];
    }
    return code || pack.id || pack.pack_id;
}

async function main() {
    console.log('\n🚀 Sincronizando punk-records con PostgreSQL...');
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });
    await client.connect();

    try {
        const startTime = Date.now();

        for (const langFolder of LANGUAGES) {
            const langCode = LANG_CODE_MAP[langFolder];
            const langDir = path.join(PUNK_ROOT, langFolder);
            const packsFile = path.join(langDir, 'packs.json');
            const cardsDir = path.join(langDir, 'cards');

            if (!fs.existsSync(packsFile)) {
                console.warn(`[SKIP] ${langFolder}: packs.json no encontrado`);
                continue;
            }

            console.log(`\n=== Procesando ${langFolder} (${langCode}) ===`);
            const packsObj = readJson(packsFile);
            if (!packsObj) continue;

            const packs = Array.isArray(packsObj) ? packsObj : Object.values(packsObj);

            // 1. Insertar sets
            for (const pack of packs) {
                const code = getPackCode(pack);
                if (!code) continue;
                await client.query(`
                    INSERT INTO sets (code, raw_title, total_cards)
                    VALUES ($1, $2, 0)
                    ON CONFLICT(code) DO UPDATE SET raw_title = EXCLUDED.raw_title
                `, [code, pack.raw_title || pack.title || code]);
            }

            if (!fs.existsSync(cardsDir)) continue;

            // Mapear packDir -> setId
            const setRows = (await client.query('SELECT id, code FROM sets')).rows;
            const codeToSetId = {};
            for (const r of setRows) codeToSetId[r.code] = r.id;

            const packIdToSetId = {};
            for (const pack of packs) {
                const numericId = pack.id;
                const code = getPackCode(pack);
                if (codeToSetId[code] && numericId) packIdToSetId[numericId] = codeToSetId[code];
            }

            const packDirs = fs.readdirSync(cardsDir).filter(entry =>
                fs.statSync(path.join(cardsDir, entry)).isDirectory()
            );

            let totalCards = 0;
            for (const packDir of packDirs) {
                let setId = packIdToSetId[packDir];
                const packPath = path.join(cardsDir, packDir);
                const cardFiles = fs.readdirSync(packPath).filter(f => f.endsWith('.json'));

                if (!setId && cardFiles.length > 0) {
                    const inferredCode = cardFiles[0].split('-')[0];
                    if (codeToSetId[inferredCode]) {
                        setId = codeToSetId[inferredCode];
                    } else {
                        const ins = await client.query(`
                            INSERT INTO sets (code, raw_title, total_cards)
                            VALUES ($1, $1, 0)
                            ON CONFLICT(code) DO UPDATE SET raw_title = EXCLUDED.raw_title
                            RETURNING id
                        `, [inferredCode]);
                        setId = ins.rows[0].id;
                        codeToSetId[inferredCode] = setId;
                    }
                    if (setId) packIdToSetId[packDir] = setId;
                }

                if (!setId) continue;

                const cards = cardFiles.map(f => readJson(path.join(packPath, f))).filter(Boolean);
                if (cards.length === 0) continue;

                await client.query('BEGIN');
                for (const card of cards) {
                    const cardCode = card.id;
                    if (!cardCode) continue;

                    await client.query(`
                        INSERT INTO cards (card_code, set_id, category, colors, cost, power, counter, rarity, attributes, types)
                        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
                        ON CONFLICT(card_code) DO NOTHING
                    `, [
                        cardCode,
                        setId,
                        card.category || null,
                        safeArr(card.colors),
                        safeInt(card.cost),
                        safeInt(card.power),
                        safeInt(card.counter),
                        card.rarity || null,
                        safeArr(card.attributes),
                        safeArr(card.types),
                    ]);

                    await client.query(`
                        INSERT INTO card_locales (card_code, language, name, effect, trigger, img_url)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT(card_code, language) DO UPDATE SET
                            name = EXCLUDED.name,
                            effect = EXCLUDED.effect,
                            trigger = EXCLUDED.trigger,
                            img_url = EXCLUDED.img_url
                    `, [
                        cardCode,
                        langCode,
                        card.name || cardCode,
                        card.effect || null,
                        card.trigger || null,
                        card.img_full_url || card.img_url || null,
                    ]);
                }
                await client.query('COMMIT');

                totalCards += cards.length;
                process.stdout.write(`  pack ${packDir}: ${cards.length} cartas\n`);
            }

            console.log(`  Subtotal ${langFolder}: ${totalCards} cartas procesadas`);
        }

        // Recalcular conteo de cartas por set
        await client.query(`
            UPDATE sets s SET total_cards = (
                SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id
            )
        `);

        const stats = await client.query(`
            SELECT 
                (SELECT count(*) FROM sets) AS sets,
                (SELECT count(*) FROM cards) AS cards,
                (SELECT count(*) FROM card_locales) AS locales
        `);

        console.log('\n=============================');
        console.log(`  Sets:    ${stats.rows[0].sets}`);
        console.log(`  Cartas:  ${stats.rows[0].cards}`);
        console.log(`  Locales: ${stats.rows[0].locales}`);
        console.log(`  Tiempo:  ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        console.log('=============================\n');

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error durante la importación:', err);
    } finally {
        await client.end();
    }
}

main().catch(console.error);
