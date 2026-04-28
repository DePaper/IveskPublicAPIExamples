/**
 * Example: load custom column values from Public API with pagination,
 * and persist modifiedsince watermark for incremental sync.
 *
 * Usage:
 *   node examples/columns-pagination.js <api-key> <company-code> <column> [modified-since]
 *
 * Examples:
 *   node examples/columns-pagination.js dp_xxx LT123 allocation
 *   node examples/columns-pagination.js dp_xxx LT123 department 2026-04-01T00:00:00.000Z
 */

const fs = require("fs").promises;
const path = require("path");

/**
 * @typedef {object} ColumnItem
 * @property {string} code
 * @property {string} [description]
 * @property {string} modifiedat
 */

/**
 * @typedef {object} ColumnsPageResponse
 * @property {ColumnItem[]} items
 * @property {string} [next]
 */

const BASE_URL = "https://stagingapp.ivesk.lt/api/pub";
const WATERMARKS_FILE = path.resolve(__dirname, ".columns-watermarks.json");

/**
 * @param {{
 *   apiKey: string;
 *   companyCode: string;
 *   column: string;
 *   next?: string;
 *   modifiedsince?: string;
 * }} params
 * @returns {Promise<ColumnsPageResponse>}
 */
async function getColumnsPage(params) {
    const search = new URLSearchParams();
    search.set("column", params.column);

    if (params.next) { search.set("next", params.next); }
    if (params.modifiedsince) { search.set("modifiedsince", params.modifiedsince); }

    const url = `${BASE_URL}/columns/${encodeURIComponent(params.companyCode)}?${search.toString()}`;
    const response = await fetch(url, {
        method: "GET",
        headers: { "x-api-key": params.apiKey, },
    });

    if (!response.ok) {
        let details = response.statusText;
        try {
            const body = await response.json();
            if (body?.message) {
                details = body.message;
            }
        } catch {
            // Ignore JSON parse errors and use status text fallback.
        }

        throw new Error(`GET /columns failed (${response.status}): ${details}`);
    }

    return response.json();
}

/**
 * @returns {Promise<Record<string, string>>}
 */
async function loadWatermarks() {
    try {
        const data = await fs.readFile(WATERMARKS_FILE, "utf8");
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== "object") {
            return {};
        }

        return parsed;
    } catch (error) {
        if (/** @type {{ code?: string }} */ (error).code === "ENOENT") {
            return {};
        }

        throw error;
    }
}

/**
 * @param {Record<string, string>} watermarks
 * @returns {Promise<void>}
 */
function saveWatermarks(watermarks) {
    return fs.writeFile(WATERMARKS_FILE, JSON.stringify(watermarks, null, 2), "utf8");
}

/**
 * @param {{
 *   apiKey: string;
 *   companyCode: string;
 *   column: string;
 *   modifiedsince?: string;
 * }} params
 * @returns {Promise<{items: ColumnItem[]; lastModifiedAt: string | null}>}
 */
async function getAllColumns(params) {
    /** @type {ColumnItem[]} */
    const allItems = [];
    let next = undefined;
    let page = 0;

    do {
        page += 1;
        const data = await getColumnsPage({
            apiKey: params.apiKey,
            companyCode: params.companyCode,
            column: params.column,
            modifiedsince: params.modifiedsince,
            next,
        });

        const items = Array.isArray(data.items) ? data.items : [];
        allItems.push(...items);
        next = data.next;

        console.log(`Page ${page}: loaded ${items.length} items`);
    } while (next);

    return {
        items: allItems,
        lastModifiedAt: getLatestModifiedAt(allItems),
    };
}

/**
 * @param {ColumnItem[]} items
 * @returns {string | null}
 */
function getLatestModifiedAt(items) {
    let latestTimestamp = 0;

    for (const item of items) {
        const timestamp = new Date(item.modifiedat).valueOf();
        if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
        }
    }

    if (latestTimestamp === 0) { return null; }

    return new Date(latestTimestamp).toISOString();
}

async function main() {
    const [apiKey, companyCode, column, modifiedSinceArg] = process.argv.slice(2);

    if (!apiKey || !companyCode || !column) {
        console.error("Usage: node examples/columns-pagination.js <api-key> <company-code> <column> [modified-since]");
        process.exitCode = 1;
        return;
    }

    const watermarkKey = `${companyCode}:${column.toLowerCase().trim()}`;
    const watermarks = await loadWatermarks();

    if (modifiedSinceArg) {
        console.log(`Using modifiedsince from argument: ${modifiedSinceArg}`);
    } else {
        console.log("No modifiedsince provided. Running full load.");
    }

    const result = await getAllColumns({
        apiKey,
        companyCode,
        column,
        modifiedsince: modifiedSinceArg,
    });

    console.log(`Total items loaded: ${result.items.length}`);
    console.log(`Latest modifiedat in this run: ${result.lastModifiedAt ?? "(not available)"}`);

    if (result.items.length > 0) {
        console.log("Loaded columns:");
        for (const item of result.items) {
            console.log(
                JSON.stringify({
                    code: item.code,
                    description: item.description ?? "",
                    modifiedat: item.modifiedat ?? "",
                }),
            );
        }
    } else {
        console.log("Loaded columns: []");
    }

    const nextWatermark = result.lastModifiedAt || modifiedSinceArg;
    if (!nextWatermark) {
        console.log("No modifiedat watermark to persist after this run.");
        return;
    }

    watermarks[watermarkKey] = nextWatermark;
    await saveWatermarks(watermarks);
    console.log(`Saved modifiedsince watermark: ${nextWatermark}`);
    console.log("To run incrementally next time, pass this value as the modified-since argument.");
}

main();
