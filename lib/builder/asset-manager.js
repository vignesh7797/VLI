const fs = require("fs");
const path = require("path");

const ASSET_EXTENSIONS = new Set([
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  // Video
  ".mp4",
  ".webm",
  // Audio
  ".mp3",
  ".wav",
]);

function isAssetModule(moduleId) {
  const extension = path.extname(moduleId).toLowerCase();

  return ASSET_EXTENSIONS.has(extension);
}

class AssetManager {
  constructor({ projectRoot, outputRoot }) {
    this.projectRoot = path.resolve(projectRoot);

    this.outputRoot = path.resolve(outputRoot);

    this.assets = new Map();

    this.outputNames = new Map();

    console.log("[VLI ASSET] Manager initialized");
  }

  resolve({ importerId, assetPath }) {
    if (!assetPath || !assetPath.startsWith(".")) {
      return null;
    }

    const importerAbsolutePath = path.join(
      this.projectRoot,
      importerId.replace(/^\//, ""),
    );

    const resolved = path.resolve(
      path.dirname(importerAbsolutePath),
      assetPath,
    );

    const relative = path.relative(this.projectRoot, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `[VLI ASSET] Unsafe asset path "${assetPath}" from "${importerId}"`,
      );
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(
        `[VLI ASSET] Asset not found "${assetPath}" from "${importerId}"`,
      );
    }

    console.log("[VLI ASSET] Resolved:", {
      importer: importerId,

      source: assetPath,

      resolved,
    });

    return resolved;
  }

  register({ importerId, assetPath }) {
    const sourcePath = this.resolve({
      importerId,
      assetPath,
    });

    if (!sourcePath) {
      return null;
    }

    /**
     * Deduplicate the same physical asset.
     */
    if (this.assets.has(sourcePath)) {
      const existing = this.assets.get(sourcePath);

      console.log("[VLI ASSET] Reusing:", {
        source: sourcePath,

        output: existing.outputUrl,
      });

      return existing;
    }

    const fileName = path.basename(sourcePath);

    const existingSource = this.outputNames.get(fileName);

    if (existingSource && existingSource !== sourcePath) {
      throw new Error(
        `[VLI ASSET] Output filename collision: "${fileName}"\n` +
          `  First: ${existingSource}\n` +
          `  Second: ${sourcePath}`,
      );
    }

    this.outputNames.set(fileName, sourcePath);

    const outputRelativePath = path.posix.join("assets", fileName);

    const record = {
      sourcePath,

      fileName,

      outputRelativePath,

      outputUrl: `./${outputRelativePath}`,
    };

    this.assets.set(sourcePath, record);

    console.log("[VLI ASSET] Registered:", {
      source: sourcePath,

      output: outputRelativePath,
    });

    return record;
  }

  registerModule(moduleId) {
    const sourcePath = path.resolve(
      this.projectRoot,
      moduleId.replace(/^\//, ""),
    );

    const relative = path.relative(this.projectRoot, sourcePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`[VLI ASSET] Unsafe asset module: "${moduleId}"`);
    }

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`[VLI ASSET] Asset module not found: "${moduleId}"`);
    }

    /**
     * Reuse asset previously registered
     * through CSS url(), for example.
     */
    if (this.assets.has(sourcePath)) {
      const existing = this.assets.get(sourcePath);

      console.log("[VLI ASSET] Reusing module asset:", {
        moduleId,
        output: existing.outputRelativePath,
      });

      return existing;
    }

    const fileName = path.basename(sourcePath);

    /**
     * Keep the collision protection
     * introduced in B2.4.3.
     */
    const existingSource = this.outputNames.get(fileName);

    if (existingSource && existingSource !== sourcePath) {
      throw new Error(
        `[VLI ASSET] Output filename collision: "${fileName}"\n` +
          `  First: ${existingSource}\n` +
          `  Second: ${sourcePath}`,
      );
    }

    this.outputNames.set(fileName, sourcePath);

    const outputRelativePath = path.posix.join("assets", fileName);

    const record = {
      sourcePath,
      fileName,
      outputRelativePath,

      outputUrl: `./${outputRelativePath}`,
    };

    this.assets.set(sourcePath, record);

    console.log("[VLI ASSET] Module registered:", {
      moduleId,

      source: sourcePath,

      output: outputRelativePath,
    });

    return record;
  }

  emitAll() {
    if (this.assets.size === 0) {
      console.log("[VLI ASSET] No assets to emit");

      return;
    }

    const assetsDirectory = path.join(this.outputRoot, "assets");

    fs.mkdirSync(assetsDirectory, {
      recursive: true,
    });

    for (const record of this.assets.values()) {
      const destination = path.join(this.outputRoot, record.outputRelativePath);

      fs.copyFileSync(record.sourcePath, destination);

      console.log("[VLI ASSET] Emitted:", {
        source: record.sourcePath,

        output: record.outputRelativePath,
      });
    }

    console.log(`[VLI ASSET] ✅ ${this.assets.size} asset(s) emitted`);
  }
}

module.exports = {
  AssetManager,
  isAssetModule,
};
