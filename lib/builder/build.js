const fs = require("fs");

const path = require("path");

const { TransformerRegistry } = require("../../transform/transformer-registry");

const {
  javascriptTransformer,
} = require("../../transform/transformers/javascript");

const { cssTransformer } = require("../../transform/transformers/css");

const { vjsTransformer } = require("../../transform/transformers/vjs");

const { transformSource } = require("../../transform/transform");

const { ModuleResolver } = require("../../transform/module-resolver");

const { BundleGraph } = require("./build-graph");

const { generateStaticBundle } = require("./bundler");

const { generateCssBundle } = require("./css-bundler");

const { AssetManager, isAssetModule } = require("./asset-manager");

/**
 * Find:
 *
 * <script type="module" src="./main.js"></script>
 */
function findModuleEntry(html) {
  const match = html.match(
    /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/i,
  );

  if (!match) {
    throw new Error("[VLI BUILD] No module script entry found in index.html");
  }

  return match[1];
}

/**
 * ./main.js
 *
 * →
 *
 * /main.js
 */
function normalizeModuleId(modulePath) {
  const normalized = modulePath.replace(/^\.\//, "").replace(/\\/g, "/");

  return "/" + normalized;
}

/**
 * Source:
 *
 * /app.vjs
 *
 * Production output:
 *
 * /app.js
 */
function getOutputModuleId(moduleId) {
  const extension = path.posix.extname(moduleId);

  if (extension === ".vjs") {
    return moduleId.slice(0, -extension.length) + ".js";
  }

  return moduleId;
}

/**
 * ----------------------------------------
 * Find static module dependencies
 * ----------------------------------------
 *
 * Supports:
 *
 * import x from './x'
 * import { x } from './x'
 * import './x'
 *
 * export { x } from './x'
 * export * from './x'
 *
 * Dynamic import() comes later.
 */
function findStaticImportSpecifiers(code) {
  const imports = new Set();

  let match;

  /**
   * import ... from '...'
   */
  const importFromRegex = /^[ \t]*import\s+[^;]*?\s+from\s+['"]([^'"]+)['"]/gm;

  while ((match = importFromRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  /**
   * import './something'
   */
  const sideEffectImportRegex = /^[ \t]*import\s+['"]([^'"]+)['"]\s*;?/gm;

  while ((match = sideEffectImportRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  /**
   * export { x } from './x'
   * export * from './x'
   */
  const exportFromRegex =
    /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g;

  while ((match = exportFromRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  return [...imports];
}

function findExportNames(code) {
  const exports = new Set();

  let match;

  /**
   * export const foo
   * export let foo
   * export var foo
   * export function foo
   * export class Foo
   */
  const declarationRegex =
    /\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;

  while ((match = declarationRegex.exec(code)) !== null) {
    exports.add(match[1]);
  }

  /**
   * export { a, b }
   */
  const namedRegex = /\bexport\s*\{([^}]+)\}/g;

  while ((match = namedRegex.exec(code)) !== null) {
    const names = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const entry of names) {
      /**
       * Handles:
       *
       * foo
       * foo as bar
       */
      const parts = entry.split(/\s+as\s+/);

      const exportedName = (parts[1] ?? parts[0]).trim();

      exports.add(exportedName);
    }
  }

  /**
   * export default ...
   */
  if (/\bexport\s+default\b/.test(code)) {
    exports.add("default");
  }

  return [...exports];
}

function findDynamicImportSpecifiers(code) {
  const imports = new Set();

  const dynamicRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match;

  while ((match = dynamicRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  return [...imports];
}

/**
 * ----------------------------------------
 * Find CSS @import dependencies
 * ----------------------------------------
 *
 * Supports:
 *
 * @import "./base.css";
 * @import './base.css';
 * @import url("./base.css");
 * @import url('./base.css');
 *
 * External imports are detected but will
 * not be resolved by VLI.
 */
function findCssImportSpecifiers(code) {
  const imports = new Set();

  /**
   * Matches:
   *
   * @import "./base.css";
   * @import url("./base.css");
   */
  const importRegex = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/gi;

  let match;

  while ((match = importRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  return [...imports];
}

/**
 * ----------------------------------------
 * Production browser import path
 * ----------------------------------------
 *
 * importer:
 * /main.js
 *
 * dependency:
 * /app.vjs
 *
 * emitted dependency:
 * /app.js
 *
 * browser path:
 * ./app.js
 */
function createProductionImportPath(importerId, dependencyId) {
  const importerOutputId = getOutputModuleId(importerId);

  const dependencyOutputId = getOutputModuleId(dependencyId);

  const importerDirectory = path.posix.dirname(importerOutputId);

  let relativePath = path.posix.relative(importerDirectory, dependencyOutputId);

  /**
   * Browser relative imports must
   * begin with ./ or ../
   */
  if (!relativePath.startsWith(".")) {
    relativePath = "./" + relativePath;
  }

  return relativePath;
}

/**
 * ----------------------------------------
 * Rewrite production imports
 * ----------------------------------------
 */
function rewriteProductionImports({ code, moduleId, moduleResolver }) {
  console.log("[VLI BUILD] Rewriting imports:", moduleId);

  function rewriteSpecifier(importPath) {
    /**
     * Bare imports are postponed.
     *
     * Example:
     *
     * react
     * lodash
     *
     * node_modules support comes later.
     */
    if (!importPath.startsWith(".")) {
      console.log("[VLI BUILD] Bare import preserved:", importPath);

      return importPath;
    }

    const dependencyId = moduleResolver.resolve(moduleId, importPath);

    if (!dependencyId) {
      throw new Error(
        `[VLI BUILD] Cannot resolve "${importPath}" from "${moduleId}"`,
      );
    }

    const outputImportPath = createProductionImportPath(moduleId, dependencyId);

    console.log("[VLI BUILD] Import rewrite:", {
      importer: moduleId,

      source: importPath,

      resolved: dependencyId,

      output: outputImportPath,
    });

    return outputImportPath;
  }

  /**
   * import ... from '...'
   */
  code = code.replace(
    /\bimport\s+([^;]*?)\s+from\s+["']([^"']+)["']\s*;?/g,
    (match, start, importPath, end) => {
      return start + rewriteSpecifier(importPath) + end;
    },
  );

  /**
   * import './something'
   */
  code = code.replace(
    /(\bimport\s+['"])([^'"]+)(['"])/g,
    (match, start, importPath, end) => {
      return start + rewriteSpecifier(importPath) + end;
    },
  );

  /**
   * export ... from '...'
   */
  code = code.replace(
    /(\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"])([^'"]+)(['"])/g,
    (match, start, importPath, end) => {
      return start + rewriteSpecifier(importPath) + end;
    },
  );

  return code;
}

function rewriteHtmlEntry(html) {
  return html.replace(
    /(<script\b[^>]*type=["']module["'][^>]*src=["'])[^"']+(["'][^>]*>)/i,

    (match, before, after) => {
      return before + "./assets/main.js" + after;
    },
  );
}

function injectProductionStylesheet(html, cssHref) {
  const stylesheet = `<link rel="stylesheet" href="${cssHref}">`;

  /**
   * Avoid duplicate insertion.
   */
  if (html.includes("./assets/style.css")) {
    return html;
  }

  /**
   * Prefer inserting before </head>.
   */
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${stylesheet}\n</head>`);
  }

  /**
   * Fallback for very small HTML templates.
   */
  return stylesheet + "\n" + html;
}

/**
 * ----------------------------------------
 * Emit compiled module
 * ----------------------------------------
 */
function emitModule({ moduleId, code, outputRoot }) {
  const outputModuleId = getOutputModuleId(moduleId);

  const outputPath = path.join(outputRoot, outputModuleId.slice(1));

  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  fs.writeFileSync(outputPath, code, "utf8");

  console.log("[VLI BUILD] ✅ Emitted module:", {
    source: moduleId,

    output: outputModuleId,
  });
}

/**
 * ----------------------------------------
 * Recursively build module graph
 * ----------------------------------------
 */
async function buildModule({
  moduleId,
  projectRoot,
  outputRoot,
  registry,
  moduleResolver,
  visited,
  bundleGraph,
  assetManager
}) {
  /**
   * Prevent duplicate traversal.
   */
  if (visited.has(moduleId)) {
    console.log("[VLI BUILD] Module already processed:", moduleId);

    return;
  }

  visited.add(moduleId);

  console.log("--------------------------------------");

  console.log("[VLI BUILD] Processing module:", moduleId);

  const relativePath = moduleId.startsWith("/") ? moduleId.slice(1) : moduleId;

  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[VLI BUILD] Module not found: ${moduleId}`);
  }

  /**
   * --------------------------------
   * Read source
   * --------------------------------
   */
  const source = fs.readFileSync(absolutePath, "utf8");

  /**
   * --------------------------------
   * Transform source
   *
   * .js  → JS
   * .vjs → JS
   * --------------------------------
   */
  const result = await transformSource({
    id: moduleId,

    source,

    registry,

    mode: "production",
  });

  if (result.type !== "js" && result.type !== "css") {
    throw new Error(
      `[VLI BUILD] Unsupported output type for ${moduleId}: ${result.type}`,
    );
  }

  let transformedCode = result.code;

  /**
   * -------------------------------------
   * CSS MODULE
   * -------------------------------------
   *
   * CSS imports and url() dependencies come in the next checkpoints.
   */

  if (result.type === "css") {
    console.log("[VLI BUILD] CSS module discovered:", moduleId);

    const cssImportSpecifiers = findCssImportSpecifiers(transformedCode);

    console.log("[VLI CSS GRAPH] Imports:", {
      moduleId,
      imports: cssImportSpecifiers,
    });

    const resolvedCssImports = [];

    for (const importPath of cssImportSpecifiers) {
      if (
        importPath.startsWith("http://") ||
        importPath.startsWith("https://") ||
        importPath.startsWith("//")
      ) {
        console.log("[VLI CSS GRAPH] External import preserved:", importPath);

        continue;
      }

      if (!importPath.startsWith(".")) {
        console.log(
          "[VLI CSS GRAPH] Non-relative import preserved:",
          importPath,
        );

        continue;
      }

      const dependencyId = moduleResolver.resolve(moduleId, importPath);

      if (!dependencyId) {
        throw new Error(
          `[VLI CSS] Failed to resolve "${importPath}" imported by "${moduleId}"`,
        );
      }

      console.log("[VLI CSS GRAPH] Dependency:", {
        importer: moduleId,

        importPath,

        dependencyId,
      });

      resolvedCssImports.push(dependencyId);

      /**
       * Recursively process imported CSS.
       */
      await buildModule({
        moduleId: dependencyId,

        projectRoot,

        outputRoot,

        registry,

        moduleResolver,

        visited,

        bundleGraph,

        assetManager
      });
    }

    bundleGraph.addModule({
      id: moduleId,

      type: "css",

      code: transformedCode,

      imports: resolvedCssImports,

      exports: [],

      dynamicImports: [],
    });

    console.log("[VLI BUILD] CSS module registered:", {
      moduleId,
      dependencies: resolvedCssImports,
    });

    return;
  }

  console.log("[VLI BUILD] Transform complete:", moduleId);

  const exportNames = findExportNames(transformedCode);

  const dynamicImports = findDynamicImportSpecifiers(transformedCode);

  console.log("[VLI BUILD] Exports:", {
    moduleId,
    exports: exportNames,
  });

  console.log("[VLI BUILD] Dynamic imports:", {
    moduleId,
    imports: dynamicImports,
  });

  /**
   * --------------------------------
   * Discover dependencies
   * --------------------------------
   */
  const importSpecifiers = findStaticImportSpecifiers(transformedCode);

  console.log("[VLI BUILD] Imports:", {
    moduleId,
    imports: importSpecifiers,
  });

  const resolvedStaticImports = [];

  /**
   * --------------------------------
   * Recursively build dependencies
   * --------------------------------
   */
  for (const importPath of importSpecifiers) {
    /**
     * Bare package dependencies
     * come later.
     */
    if (!importPath.startsWith(".")) {
      console.log("[VLI BUILD] Skipping bare dependency:", importPath);

      continue;
    }

    const dependencyId = moduleResolver.resolve(moduleId, importPath);

    if (!dependencyId) {
      throw new Error(
        `[VLI BUILD] Failed to resolve "${importPath}" imported by "${moduleId}"`,
      );
    }

    if (isAssetModule(dependencyId)) {
      console.log("[VLI BUILD] Asset dependency:", {
        importer: moduleId,

        importPath,

        dependencyId,
      });

      assetManager.registerModule(dependencyId);

      /**
       * Keep the dependency in the module's
       * static import list.
       *
       * bundler.js needs this resolved ID
       * when rewriting the import.
       */
      resolvedStaticImports.push(dependencyId);

      continue;
    }

    resolvedStaticImports.push(dependencyId);

    console.log("[VLI BUILD] Dependency:", {
      importer: moduleId,

      importPath,

      dependencyId,
    });

    await buildModule({
      moduleId: dependencyId,

      projectRoot,

      outputRoot,

      registry,

      moduleResolver,

      visited,

      bundleGraph,

      assetManager,
    });
  }

  bundleGraph.addModule({
    id: moduleId,

    type: "js",

    code: transformedCode,

    imports: resolvedStaticImports,

    exports: exportNames,

    dynamicImports: dynamicImports,
  });

  printBundleSummary(bundleGraph);
}

function printBundleSummary(bundleGraph) {
  console.log("======================================");

  console.log("[VLI BUNDLE] Graph summary");

  const ids = bundleGraph.getModuleIds();

  console.log("[VLI BUNDLE] Modules:", ids.length);

  for (const id of ids) {
    const record = bundleGraph.getModule(id);

    console.log("[VLI BUNDLE] Module:", {
      id,

      imports: [...record.imports],

      exports: [...record.exports],

      importers: [...record.importers],
    });
  }

  console.log("======================================");
}

/**
 * ----------------------------------------
 * Main project build
 * ----------------------------------------
 */
async function buildProject({ projectRoot, outDir = "dist" }) {
  console.log("======================================");

  console.log("[VLI BUILD] Starting production build");

  console.log("[VLI BUILD] Project root:", projectRoot);

  /**
   * --------------------------------
   * Transformer registry
   * --------------------------------
   */
  const transformerRegistry = new TransformerRegistry();

  transformerRegistry.register(".js", javascriptTransformer);

  transformerRegistry.register(".vjs", vjsTransformer);

  transformerRegistry.register(".css", cssTransformer);

  console.log("[VLI BUILD] Transformers:", transformerRegistry.getExtensions());

  /**
   * --------------------------------
   * Module resolver
   * --------------------------------
   */
  const moduleResolver = new ModuleResolver({
    projectRoot,

    registry: transformerRegistry,
  });

  console.log("[VLI BUILD] Module resolver ready");

  /**
   * --------------------------------
   * Clean dist/
   * --------------------------------
   */
  const outputRoot = path.join(projectRoot, outDir);

  if (fs.existsSync(outputRoot)) {
    console.log("[VLI BUILD] Cleaning:", outputRoot);

    fs.rmSync(outputRoot, {
      recursive: true,
      force: true,
    });
  }

  fs.mkdirSync(outputRoot, {
    recursive: true,
  });

  const assetManager = new AssetManager({ projectRoot, outputRoot });

  /**
   * --------------------------------
   * index.html
   * --------------------------------
   */
  const indexPath = path.join(projectRoot, "index.html");

  if (!fs.existsSync(indexPath)) {
    throw new Error("[VLI BUILD] index.html not found");
  }

  const html = fs.readFileSync(indexPath, "utf8");

  const entry = findModuleEntry(html);

  let productionHtml = rewriteHtmlEntry(html);

  console.log("[VLI BUILD] Entry:", entry);

  const bundleGraph = new BundleGraph();

  console.log("[VLI BUILD] Bundle graph initialized");

  /**
   * --------------------------------
   * Recursive module build
   * --------------------------------
   */
  const entryId = normalizeModuleId(entry);

  const visited = new Set();

  await buildModule({
    moduleId: entryId,

    projectRoot,

    outputRoot,

    registry: transformerRegistry,

    moduleResolver,

    visited,

    bundleGraph,

    assetManager,
  });

  console.log("[VLI BUILD] Module count:", visited.size);

  bundleGraph.linkImporters();

  console.log("[VLI BUILD] Bundle graph:", bundleGraph.inspect());

  /**
   * --------------------------------
   * Generate one static production bundle
   * --------------------------------
   */
  const bundleCode = generateStaticBundle({
    bundleGraph,
    entryId,
    moduleResolver,
    assetManager
  });

  const cssBundleCode = generateCssBundle({
    bundleGraph,
    assetManager,
  });

  if(cssBundleCode){    
    productionHtml = injectProductionStylesheet(productionHtml, "./assets/style.css");
  }

  assetManager.emitAll();

  fs.writeFileSync(
    path.join(outputRoot, "index.html"),

    productionHtml,

    "utf8",
  );

  console.log("[VLI BUILD] Emitted:", "index.html");

  const assetsDirectory = path.join(outputRoot, "assets");

  fs.mkdirSync(assetsDirectory, { recursive: true });

  const bundleFileName = "main.js";

  const bundlePath = path.join(assetsDirectory, bundleFileName);

  fs.writeFileSync(bundlePath, bundleCode, "utf8");

  console.log("[VLI BUILD] ✅ Bundle emitted:", "assets/main.js");

  fs.mkdirSync(assetsDirectory, { recursive: true });

  /**
   * CSS BUNDLE Code
   */
  if (cssBundleCode) {
    const cssBundlePath = path.join(assetsDirectory, "style.css");

    fs.writeFileSync(cssBundlePath, cssBundleCode, "utf8");

    console.log("[VLI BUILD] ✅ CSS bundle emitted:", "assets/style.css");
  }

  console.log("======================================");

  console.log("[VLI BUILD] ✅ B1.2 build complete");

  console.log("[VLI BUILD] Output:", outputRoot);

  console.log("======================================");
}

module.exports = {
  buildProject,
};
