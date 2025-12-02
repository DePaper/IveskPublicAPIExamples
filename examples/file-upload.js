const fs = require('fs').promises;
const path = require('path');

/**
 * @typedef {object} UploadLocation
 * @property {string} url
 * @property {string} Content-Type
 * @property {string} Content-Disposition
 */

/**
 * @param {string} data 
 * @returns {string}
 */
function getBase64String(data) {
    const buffer = Buffer.from(data);
    return buffer.toString('base64');
}

/**
 * 
 * @param {string} apikey 
 * @param {string} filename 
 * @returns {UploadLocation}
 */
async function getUploadLocation(apikey, filename) {
    // None of the query params are required.
    const sourcedata = getBase64String(JSON.stringify({ id: 'unique-document-id', customdata: 'custom-data' }));
    const url = new URL(`https://app.ivesk.lt/api/pub/uploadlocation/${encodeURIComponent(filename)}?${encodeURIComponent(sourcedata)}&processlines=false&splitdocuments=true&checkduplicates=true&rejectnoninvoices=true&warehouse=WHS&allocation=ALLOC&tags=tag1,tag2,tag3`);
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apikey },
    });
    if (!response.ok) {
        const body = await response.json();
        throw new Error(`Error: ${response.status} ${body.message}`);
    }

    return response.json();
}

/**
 * 
 * @param {UploadLocation} uploadData 
 * @param {Buffer} file 
 */
async function uploadFile(uploadData, file) {
    const response = await fetch(uploadData.url, {
        method: 'PUT',
        body: file,
        headers: {
            'Content-Type': uploadData['Content-Type'],
            'Content-Disposition': uploadData['Content-Disposition'],
        }
    });
    if (!response.ok) { throw new Error(`Error: ${response.status} ${response.statusText}`); }

    console.log("File successfully uploaded.");
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node file-upload.js <apikey> <path-to-file>');
        return 1;    }

    const apikey = args[0];
    const filepath = args[1];

    const filename = path.basename(filepath);
    const uploadLocation = await getUploadLocation(apikey, filename);

    const data = await fs.readFile(filepath);
    await uploadFile(uploadLocation, data);
}

main();
