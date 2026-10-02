#!/usr/bin/env node
/**
 * migrate_to_postgres.js
 * Migrates all data from local SQLite (api/db/tcg.sqlite) to PostgreSQL (Neon / Vercel Postgres).
 *
 * Usage:
 *   DATABASE_URL="postgres://user:pass@host/db?sslmode=require" node scripts/migrate_to_postgres.js
 */

require('dotenv').config();
const path = require('path');
const { Client } = require('pg');

const DB_PATH = path.join(__dirname, '../api/db/tcg.sqlite');
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
    console.error('\n❌ ERROR: Debes proporcionar la URL de conexión a PostgreSQL.');
    console.error('Ejemplo de uso:');
    console.error('  DATABASE_URL="postgres://usuario:password@host.neon.tech/neondb?sslmode=require" node scripts/migrate_to_postgres.js\n');
    process.exit(1);
}

// 1. Conexión a SQLite
let sqliteDb;
try {
    const { DatabaseSync } = require('node:sqlite');
    sqliteDb = new DatabaseSync(DB_PATH, { readOnly: true });
} catch {
    const Database = require('better-sqlite3');
    sqliteDb = new Database(DB_PATH, { readonly: true });
}

async function runMigration() {
    console.log('\n🚀 Iniciando migración de SQLite a PostgreSQL...');
    console.log(`📁 Origen SQLite: ${DB_PATH}`);

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    console.log('✅ Conectado exitosamente a PostgreSQL.');

    try {
        console.log('\n📦 Creando tablas e índices en PostgreSQL si no existen...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS sets (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                raw_title TEXT NOT NULL,
                total_cards INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS cards (
                card_code VARCHAR(50) PRIMARY KEY,
                set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
                category VARCHAR(50),
                colors JSONB DEFAULT '[]'::jsonb,
                cost INTEGER,
                power INTEGER,
                counter INTEGER,
                rarity VARCHAR(50),
                attributes JSONB DEFAULT '[]'::jsonb,
                types JSONB DEFAULT '[]'::jsonb,
                price_data JSONB,
                price_cached_at BIGINT
            );

            CREATE TABLE IF NOT EXISTS card_locales (
                id SERIAL PRIMARY KEY,
                card_code VARCHAR(50) NOT NULL REFERENCES cards(card_code) ON DELETE CASCADE,
                language VARCHAR(10) NOT NULL CHECK(language IN ('en','jp')),
                name TEXT NOT NULL,
                effect TEXT,
                trigger TEXT,
                img_url TEXT,
                UNIQUE(card_code, language)
            );

            CREATE TABLE IF NOT EXISTS collection (
                id SERIAL PRIMARY KEY,
                card_code VARCHAR(50) NOT NULL REFERENCES cards(card_code) ON DELETE CASCADE,
                language VARCHAR(10) NOT NULL CHECK(language IN ('en','jp')),
                quantity INTEGER NOT NULL DEFAULT 1,
                condition VARCHAR(50) NOT NULL DEFAULT 'near_mint',
                added_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
                price_usd NUMERIC(10, 2) DEFAULT NULL,
                UNIQUE(card_code, language)
            );

            CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id);
            CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
            CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
            CREATE INDEX IF NOT EXISTS idx_locales_lang ON card_locales(language);
            CREATE INDEX IF NOT EXISTS idx_locales_name ON card_locales(name);
            CREATE INDEX IF NOT EXISTS idx_collection_code ON collection(card_code);
        `);

        function safeJson(val, fallback = '[]') {
            if (!val) return fallback;
            try {
                if (typeof val === 'object') return JSON.stringify(val);
                JSON.parse(val);
                return val;
            } catch {
                return fallback;
            }
        }

        // --- Migrar SETS ---
        console.log('\n⏳ Migrando SETS...');
        const sets = sqliteDb.prepare('SELECT id, code, raw_title, total_cards FROM sets ORDER BY id ASC').all();
        await client.query('BEGIN');
        for (const s of sets) {
            await client.query(`
                INSERT INTO sets (id, code, raw_title, total_cards)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO UPDATE SET
                    code = EXCLUDED.code,
                    raw_title = EXCLUDED.raw_title,
                    total_cards = EXCLUDED.total_cards
            `, [s.id, s.code, s.raw_title, s.total_cards || 0]);
        }
        await client.query('COMMIT');
        console.log(`✅ ${sets.length} sets migrados.`);

        // --- Migrar CARDS ---
        console.log('\n⏳ Migrando CARDS (esto puede tardar unos segundos)...');
        const cards = sqliteDb.prepare('SELECT * FROM cards').all();
        const CARD_BATCH = 200;
        await client.query('BEGIN');
        for (let i = 0; i < cards.length; i += CARD_BATCH) {
            const batch = cards.slice(i, i + CARD_BATCH);
            for (const c of batch) {
                await client.query(`
                    INSERT INTO cards (card_code, set_id, category, colors, cost, power, counter, rarity, attributes, types, price_data, price_cached_at)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
                    ON CONFLICT (card_code) DO UPDATE SET
                        set_id = EXCLUDED.set_id,
                        category = EXCLUDED.category,
                        colors = EXCLUDED.colors,
                        cost = EXCLUDED.cost,
                        power = EXCLUDED.power,
                        counter = EXCLUDED.counter,
                        rarity = EXCLUDED.rarity,
                        attributes = EXCLUDED.attributes,
                        types = EXCLUDED.types,
                        price_data = EXCLUDED.price_data,
                        price_cached_at = EXCLUDED.price_cached_at
                `, [
                    c.card_code,
                    c.set_id,
                    c.category,
                    safeJson(c.colors, '[]'),
                    c.cost !== null ? c.cost : null,
                    c.power !== null ? c.power : null,
                    c.counter !== null ? c.counter : null,
                    c.rarity,
                    safeJson(c.attributes, '[]'),
                    safeJson(c.types, '[]'),
                    c.price_data ? safeJson(c.price_data, null) : null,
                    c.price_cached_at ? Number(c.price_cached_at) : null
                ]);
            }
            process.stdout.write(`  ${Math.min(i + CARD_BATCH, cards.length)} / ${cards.length} cartas...\r`);
        }
        await client.query('COMMIT');
        console.log(`\n✅ ${cards.length} cartas migradas.`);

        // --- Migrar CARD_LOCALES ---
        console.log('\n⏳ Migrando CARD_LOCALES...');
        const locales = sqliteDb.prepare('SELECT id, card_code, language, name, effect, trigger, img_url FROM card_locales ORDER BY id ASC').all();
        const LOCALE_BATCH = 200;
        await client.query('BEGIN');
        for (let i = 0; i < locales.length; i += LOCALE_BATCH) {
            const batch = locales.slice(i, i + LOCALE_BATCH);
            for (const l of batch) {
                await client.query(`
                    INSERT INTO card_locales (id, card_code, language, name, effect, trigger, img_url)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (card_code, language) DO UPDATE SET
                        name = EXCLUDED.name,
                        effect = EXCLUDED.effect,
                        trigger = EXCLUDED.trigger,
                        img_url = EXCLUDED.img_url
                `, [l.id, l.card_code, l.language, l.name, l.effect, l.trigger, l.img_url]);
            }
            process.stdout.write(`  ${Math.min(i + LOCALE_BATCH, locales.length)} / ${locales.length} locales...\r`);
        }
        await client.query('COMMIT');
        console.log(`\n✅ ${locales.length} localizaciones migradas.`);

        // --- Migrar COLLECTION ---
        console.log('\n⏳ Migrando TU COLECCIÓN...');
        const collection = sqliteDb.prepare('SELECT id, card_code, language, quantity, condition, added_at, price_usd FROM collection ORDER BY id ASC').all();
        await client.query('BEGIN');
        for (const col of collection) {
            await client.query(`
                INSERT INTO collection (id, card_code, language, quantity, condition, added_at, price_usd)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (card_code, language) DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    condition = EXCLUDED.condition,
                    added_at = EXCLUDED.added_at,
                    price_usd = EXCLUDED.price_usd
            `, [col.id, col.card_code, col.language, col.quantity || 1, col.condition || 'near_mint', Number(col.added_at) || Math.floor(Date.now() / 1000), col.price_usd]);
        }
        await client.query('COMMIT');
        console.log(`✅ ${collection.length} cartas de tu colección migradas.`);

        // --- Actualizar secuencias SERIAL ---
        console.log('\n⏳ Sincronizando secuencias de IDs...');
        await client.query(`
            SELECT setval('sets_id_seq', COALESCE((SELECT MAX(id) FROM sets), 1));
            SELECT setval('card_locales_id_seq', COALESCE((SELECT MAX(id) FROM card_locales), 1));
            SELECT setval('collection_id_seq', COALESCE((SELECT MAX(id) FROM collection), 1));
        `);

        // --- Verificación ---
        const counts = await client.query(`
            SELECT 
                (SELECT count(*) FROM sets) AS sets_count,
                (SELECT count(*) FROM cards) AS cards_count,
                (SELECT count(*) FROM card_locales) AS locales_count,
                (SELECT count(*) FROM collection) AS collection_count
        `);

        console.log('\n==========================================');
        console.log('🎉 ¡MIGRACIÓN COMPLETADA CON ÉXITO!');
        console.log(`  Sets en PostgreSQL:       ${counts.rows[0].sets_count}`);
        console.log(`  Cartas en PostgreSQL:     ${counts.rows[0].cards_count}`);
        console.log(`  Locales (EN/JP):          ${counts.rows[0].locales_count}`);
        console.log(`  Colección preservada:     ${counts.rows[0].collection_count}`);
        console.log('==========================================\n');

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('\n❌ ERROR durante la migración:', err);
    } finally {
        await client.end();
        if (typeof sqliteDb.close === 'function') sqliteDb.close();
    }
}

runMigration().catch(console.error);
