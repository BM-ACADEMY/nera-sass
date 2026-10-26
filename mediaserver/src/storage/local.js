/**
 * Local disk storage driver. Only stores and reads already-encrypted bytes, so
 * a cloud driver (R2 / S3) can replace it with the same four methods:
 *   putFile(key, tempPath)   move a finished encrypted file into place
 *   readRange(key, start, length) -> Buffer
 *   remove(key)
 *   tempPath()               where a new encrypted file is assembled
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createLocalStorage(root) {
  const tempDir = path.join(root, '.tmp');
  fs.mkdirSync(tempDir, { recursive: true });

  const fullPath = (key) => {
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return target;
  };

  return {
    tempPath: () => path.join(tempDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.part`),

    async putFile(key, tempPath) {
      const target = fullPath(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.rename(tempPath, target);
    },

    async readRange(key, start, length) {
      const handle = await fs.promises.open(fullPath(key), 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    async remove(key) {
      await fs.promises.unlink(fullPath(key)).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
    },
  };
}

module.exports = { createLocalStorage };
