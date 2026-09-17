/**
 * VLI Static Bundler — B2.2
 *
 * Converts the transformed ESM modules stored
 * inside BundleGraph into one executable bundle.
 *
 * This is our first bundler implementation.
 *
 * Dynamic imports and node_modules are intentionally
 * excluded from B2.2.
 */

/**
 * Resolve an import from the source module
 * into its canonical BundleGraph module ID.
 */

const path = require("path");
const { isAssetModule } = require("./asset-manager");

function resolveDependency({ importerId, importPath, moduleResolver }) {
  if (!importPath.startsWith(".")) {
    throw new Error(
      `[VLI BUNDLE] Bare package import "${importPath}" is not supported yet`,
    );
  }

  const dependencyId = moduleResolver.resolve(importerId, importPath);

  if (!dependencyId) {
    throw new Error(
      `[VLI BUNDLE] Cannot resolve "${importPath}" from "${importerId}"`,
    );
  }

  return dependencyId;
}

/**
 * Convert:
 *
 * import { foo, bar as baz }
 *
 * into:
 *
 * const {
 *   foo,
 *   bar: baz
 * } = __vliRequire(...)
 */
function transformNamedImportClause(clause) {
  const content = clause.trim().replace(/^\{/, "").replace(/\}$/, "");

  const entries = content
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+as\s+/);

      if (parts.length === 2) {
        return parts[0].trim() + ": " + parts[1].trim();
      }

      return entry;
    });

  return "{ " + entries.join(", ") + " }";
}

/**
 * Transform one normal static import.
 */
function transformImportClause({ clause, dependencyId, importIndex }) {
  const trimmed = clause.trim();

  /**
   * import * as utils from './utils'
   */
  if (trimmed.startsWith("*")) {
    const match = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);

    if (!match) {
      throw new Error(`[VLI BUNDLE] Unsupported namespace import: ${trimmed}`);
    }

    return (
      `const ${match[1]} = ` + `__vliRequire(${JSON.stringify(dependencyId)});`
    );
  }

  /**
   * import { foo, bar } from './x'
   */
  if (trimmed.startsWith("{")) {
    const destructuring = transformNamedImportClause(trimmed);

    return (
      `const ${destructuring} = ` +
      `__vliRequire(${JSON.stringify(dependencyId)});`
    );
  }

  /**
   * Default + another import:
   *
   * import React, { useState } from '...'
   *
   * We support the syntax here even though
   * package resolution itself comes later.
   */
  const commaIndex = trimmed.indexOf(",");

  if (commaIndex !== -1) {
    const defaultName = trimmed.slice(0, commaIndex).trim();

    const remainder = trimmed.slice(commaIndex + 1).trim();

    const namespaceName = `__vliImport_${importIndex}`;

    let code = `
const ${namespaceName} =
  __vliRequire(
    ${JSON.stringify(dependencyId)}
  );

const ${defaultName} =
  ${namespaceName}.default;
`;

    if (remainder.startsWith("{")) {
      const named = transformNamedImportClause(remainder);

      code += `
const ${named} =
  ${namespaceName};
`;
    } else if (remainder.startsWith("*")) {
      const namespaceMatch = remainder.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);

      if (!namespaceMatch) {
        throw new Error(`[VLI BUNDLE] Unsupported import clause: ${clause}`);
      }

      code += `
const ${namespaceMatch[1]} =
  ${namespaceName};
`;
    }

    return code;
  }

  /**
   * import Foo from './Foo'
   */
  return `
const ${trimmed} =
  __vliRequire(
    ${JSON.stringify(dependencyId)}
  ).default;
`;
}

function parseNamedImports(clause) {
  const content = clause.trim().replace(/^\{/, "").replace(/\}$/, "");

  return content
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+as\s+/);

      if (parts.length == 2) {
        return {
          imported: parts[0].trim(),
          local: parts[1].trim(),
        };
      }

      return {
        imported: entry,
        local: entry,
      };
    });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteImportedBindingReferences({ code, bindings }) {

  let rewrittenCode = code;

  for (const binding of bindings) {
    // const { local, namespaceName, imported,  } = binding;
    const { local, namespaceName, imported } = binding;

    const accessExpression = `${namespaceName}.${imported}`;

    console.log("[VLI BUNDLE] Rewriting live binding:", {
      local,
      namespaceName,
      imported,
      accessExpression,
    });

    /**
     * ==========================================
     * OBJECT SHORTHAND
     * ==========================================
     */
    rewrittenCode = rewriteObjectShorthand({ code: rewrittenCode, local, accessExpression });

    /**
     * ==========================================
     * NORMAL LIVE-BINDING REFERENCES
     * ==========================================
     */
    const referencePattern = new RegExp(`\\b${escapeRegExp(local)}\\b`, "g");

    rewrittenCode = rewrittenCode.replace(
      referencePattern,
      (match, offset, source) => {
        const before = source.slice(Math.max(0, offset - 1), offset);
        const after = source.slice(offset + match.length);

        if (/^\s*:/.test(after)) {
          return match;
        }

        if (before === ".") {
          return match;
        }

        return accessExpression;
      },
    );
  }

  return rewrittenCode;
}

function rewriteObjectShorthand({ code, local, accessExpression }) {
  let output = "";

  let index = 0;

  let braceDepth = 0;

  let quote = null;

  let escaped = false;

  while (index < code.length) {
    const char = code[index];

    /**
     * --------------------------------
     * STRING HANDLING
     * --------------------------------
     */
    if (quote) {
      output += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      index++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;

      output += char;

      index++;
      continue;
    }

    /**
     * --------------------------------
     * BRACE TRACKING
     * --------------------------------
     */
    if (char === "{") {
      braceDepth++;

      output += char;

      index++;
      continue;
    }

    if (char === "}") {
      braceDepth--;

      output += char;

      index++;
      continue;
    }

    /**
     * --------------------------------
     * POSSIBLE IDENTIFIER
     * --------------------------------
     */
    if (braceDepth > 0 && code.startsWith(local, index)) {
      const before = code[index - 1] || "";

      const after = code[index + local.length] || "";

      const validBefore = !/[A-Za-z0-9_$]/.test(before);

      const validAfter = !/[A-Za-z0-9_$]/.test(after);

      if (validBefore && validAfter) {
        const remaining = code.slice(index + local.length);

        /**
         * Object shorthand must
         * terminate with "," or "}".
         */
        if (/^\s*[,}]/.test(remaining)) {
          console.log("[VLI BUNDLE] Object shorthand:", {
            local,
            accessExpression,
            braceDepth,
          });

          output += `${local}: ` + accessExpression;

          index += local.length;

          continue;
        }
      }
    }

    output += char;

    index++;
  }

  return output;
}

/**
 * Transform ESM imports into our internal
 * bundle runtime calls.
 */
function transformImports({ code, moduleId, moduleResolver, assetManager }) {
  const liveBindings = [];

  let importVariableIndex = 0;

  function createImportVariableName() {
    const name = `__vliImport_${importVariableIndex}`;

    importVariableIndex += 1;

    return name;
  }

  const importFromRegex =
    /^[ \t]*import\s+([^;]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;

  code = code.replace(
    importFromRegex,

    (match, clause, importPath) => {
      console.log(
        "[VLI BUNDLE DEBUG] Import match:",
        "Default import:",
        JSON.stringify(match),
      );

      const dependencyId = resolveDependency({
        importerId: moduleId,

        importPath,

        moduleResolver,
      });

      const trimmedClause = clause.trim();

      console.log("[VLI BUNDLE] Import:", {
        importer: moduleId,

        source: importPath,

        dependency: dependencyId,

        clause: trimmedClause,
      });

      /**
       * ==================================
       * ASSET DEFAULT IMPORT
       * ==================================
       *
       * import logo from "./logo.png";
       */
      if (isAssetModule(dependencyId)) {
        if (!/^[A-Za-z_$][\w$]*$/.test(trimmedClause)) {
          throw new Error(
            `[VLI BUNDLE] Asset imports require a default import in ${moduleId}: ${match}`,
          );
        }

        const asset = assetManager.registerModule(dependencyId);

        const assetUrl = `./assets/${asset.fileName}`;

        console.log("[VLI BUNDLE] Asset import:", {
          local: trimmedClause,

          output: assetUrl,
        });

        return `const ${trimmedClause} = ` + `${JSON.stringify(assetUrl)};`;
      }

      /**
       * ==================================
       * NAMESPACE IMPORT
       * ==================================
       *
       * import * as utils from "./utils";
       */
      const namespaceMatch = trimmedClause.match(
        /^\*\s+as\s+([A-Za-z_$][\w$]*)$/,
      );

      if (namespaceMatch) {
        const localName = namespaceMatch[1];

        return (
          `const ${localName} = ` +
          `__vliRequire(${JSON.stringify(dependencyId)});`
        );
      }

      /**
       * ==================================
       * NAMED IMPORT
       * ==================================
       *
       * import {
       *   getMessage,
       *   count,
       *   increment
       * } from "./utils/index";
       */
      if (trimmedClause.startsWith("{") && trimmedClause.endsWith("}")) {
        const bindingsText = trimmedClause.slice(1, -1).trim();

        if (!bindingsText) {
          return "";
        }

        /**
         * One namespace object for this import.
         *
         * Example:
         *
         * const __vliImport_1 =
         *   __vliRequire("/utils/index.js");
         */
        const namespaceName = createImportVariableName();

        const bindings = bindingsText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        for (const binding of bindings) {
          const parts = binding.split(/\s+as\s+/);

          const importedName = parts[0].trim();

          const localName = (parts[1] || parts[0]).trim();

          liveBindings.push({
            local: localName,
            namespaceName,
            imported: importedName,
          });

          console.log("[VLI BUNDLE] Live binding:", {
            importer: moduleId,

            dependency: dependencyId,

            importedName,

            localName,

            namespaceName,
          });
        }

        return (
          `const ${namespaceName} = ` +
          `__vliRequire(${JSON.stringify(dependencyId)});`
        );
      }

      /**
       * ==================================
       * DEFAULT JS/VJS IMPORT
       * ==================================
       *
       * import App from "./app";
       */
      if (/^[A-Za-z_$][\w$]*$/.test(trimmedClause)) {
        const tempName = createImportVariableName();

        return (
          `const ${tempName} = ` +
          `__vliRequire(${JSON.stringify(dependencyId)});\n` +
          `const ${trimmedClause} = ` +
          `${tempName}.default;`
        );
      }

      throw new Error(
        `[VLI BUNDLE] Unsupported import syntax in ${moduleId}: ${match}`,
      );
    },
  );

  /**
   * Side-effect import:
   *
   * import './setup'
   */
  code = code.replace(
    /^[ \t]*import\s+['"]([^'"]+)['"]\s*;?/gm,

    (match, importPath) => {
      console.log(
        "[VLI BUNDLE DEBUG] Import match:",
        "Side effect import:",
        JSON.stringify(match),
      );
      const dependencyId = resolveDependency({
        importerId: moduleId,

        importPath,

        moduleResolver,
      });

      const extension = path.posix.extname(dependencyId);

      if (extension === ".css") {
        console.log("[VLI BUNDLE] CSS import extracted:", {
          importer: moduleId,
          dependency: dependencyId,
        });

        return "";
      }

      return `__vliRequire(${JSON.stringify(dependencyId)});`;
    },
  );

  /**
   * --------------------------------
   * Rewrite references AFTER imports
   * have been removed.
   * --------------------------------
   */
  console.log("[VLI BUNDLE] Live bindings before rewrite:", {
    moduleId,
    bindings: liveBindings,
  });

  code = rewriteImportedBindingReferences({
    code,
    bindings: liveBindings,
  });

  return code;
}

/**
 * Parse:
 *
 * export { foo, bar as baz }
 *
 * and return:
 *
 * [
 *   { local: "foo", exported: "foo" },
 *   { local: "bar", exported: "baz" }
 * ]
 */
function parseExportList(content) {
  return content
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+as\s+/);

      if (parts.length === 2) {
        return {
          local: parts[0].trim(),

          exported: parts[1].trim(),
        };
      }

      return {
        local: entry,

        exported: entry,
      };
    });
}

/**
 * Convert ES exports into runtime export getters.
 */
function transformExports({ code, moduleId, moduleResolver }) {
  let reExportIndex = 0;

  const localExports = [];

  /**
   * --------------------------------
   * Re-export all
   *
   * export * from './message'
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]\s*;?/g,

    (match, importPath) => {
      const dependencyId = resolveDependency({
        importerId: moduleId,

        importPath,

        moduleResolver,
      });

      return `
            __vliReExport(
            exports,
            __vliRequire(
                ${JSON.stringify(dependencyId)}
            )
            );
        `;
    },
  );

  /**
   * --------------------------------
   * Named re-export
   *
   * export {
   *   getMessage
   * } from './message'
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,

    (match, exportContent, importPath) => {
      const dependencyId = resolveDependency({
        importerId: moduleId,

        importPath,

        moduleResolver,
      });

      const exportsList = parseExportList(exportContent);

      const namespaceName = "__vliReExportModule_" + reExportIndex;

      reExportIndex++;

      let output = `
                const ${namespaceName} =
                __vliRequire(
                    ${JSON.stringify(dependencyId)}
                );
            `;

      for (const item of exportsList) {
        output += `
                    __vliExportGetter(
                        exports,
                        ${JSON.stringify(item.exported)},
                        () => ${namespaceName}[${JSON.stringify(item.local)}]
                    );
                `;
      }

      return output;
    },
  );

  /**
   * --------------------------------
   * export function foo()
   * export class Foo
   * export const foo
   * export let foo
   * export var foo
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,

    (match, declarationType, name) => {
      localExports.push({
        local: name,

        exported: name,
      });

      return declarationType + " " + name;
    },
  );

  /**
   * --------------------------------
   * Named local exports
   *
   * export {
   *   foo,
   *   bar as baz
   * };
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s*\{([^}]+)\}\s*;?/g,

    (match, exportContent) => {
      const exportsList = parseExportList(exportContent);

      localExports.push(...exportsList);

      return "";
    },
  );

  /**
   * --------------------------------
   * Named default function
   *
   * export default function foo()
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/g,

    (match, name) => {
      localExports.push({
        local: name,

        exported: "default",
      });

      return "function " + name;
    },
  );

  /**
   * --------------------------------
   * Named default class
   * --------------------------------
   */
  code = code.replace(
    /\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)/g,

    (match, name) => {
      localExports.push({
        local: name,

        exported: "default",
      });

      return "class " + name;
    },
  );

  /**
   * Simple default expression:
   *
   * export default foo;
   *
   * export default 123;
   *
   * B2.2 intentionally keeps this
   * simple.
   */
  code = code.replace(
    /\bexport\s+default\s+([^;]+);/g,

    (match, expression) => {
      const localName = "__vliDefaultExport";

      localExports.push({
        local: localName,

        exported: "default",
      });

      return `const ${localName} = ${expression};`;
    },
  );

  /**
   * Export getters are intentionally
   * placed before module execution.
   *
   * This provides better circular-dependency
   * behavior than copying values after execution.
   */
  const exportSetup = localExports
    .map(
      ({ local, exported }) => `
__vliExportGetter(
  exports,
  ${JSON.stringify(exported)},
  () => ${local}
);
`,
    )
    .join("\n");

  return exportSetup + "\n" + code;
}

/**
 * Transform one BundleGraph module into
 * our internal factory format.
 */
function transformBundleModule({
  moduleId,
  code,
  moduleResolver,
  assetManager,
}) {
  console.log("[VLI BUNDLE] Transforming module:", moduleId);

  let transformed = code;

  /**
   * Re-exports must be transformed
   * before regular imports.
   */
  transformed = transformExports({
    code: transformed,

    moduleId,

    moduleResolver,
  });

  transformed = transformImports({
    code: transformed,

    moduleId,

    moduleResolver,

    assetManager,
  });

  return transformed;
}

/**
 * Verify B2.2 graph constraints.
 */
function validateStaticBundle(bundleGraph) {
  for (const moduleId of bundleGraph.getModuleIds()) {
    const moduleRecord = bundleGraph.getModule(moduleId);

    if (moduleRecord.dynamicImports.size > 0) {
      throw new Error(
        `[VLI BUNDLE] Dynamic import found in "${moduleId}". Dynamic chunks are planned for B2.5.`,
      );
    }
  }
}

/**
 * Generate the executable JavaScript bundle.
 */
function generateStaticBundle({
  bundleGraph,
  entryId,
  moduleResolver,
  assetManager,
}) {
  console.log("======================================");

  console.log("[VLI BUNDLE] Generating static bundle");

  console.log("[VLI BUNDLE] Entry:", entryId);

  validateStaticBundle(bundleGraph);

  const factories = [];

  for (const moduleId of bundleGraph.getModuleIds()) {
    const moduleRecord = bundleGraph.getModule(moduleId);

    if (moduleRecord.type !== "js") {
      console.log("[VLI BUNDLE] Skipping non-JS module:", {
        id: moduleId,

        type: moduleRecord.type,
      });

      continue;
    }

    const transformedCode = transformBundleModule({
      moduleId,

      code: moduleRecord.code,

      moduleResolver,

      assetManager,
    });

    factories.push(`
        ${JSON.stringify(moduleId)}:
        function(
        module,
        exports,
        __vliRequire,
        __vliExportGetter,
        __vliReExport
        ) {

        ${transformedCode}

        }
    `);
  }

  const bundle = `
        /**
         * ==========================================
         * VLI Production Bundle
         * ==========================================
         */

        const __vliModules = {

        ${factories.join(",\n")}

        };


        const __vliModuleCache =
        Object.create(null);


        /**
         * Define an ES-module-like live export.
         */
        function __vliExportGetter(
        exports,
        name,
        getter
        ) {

        if (
            Object.prototype.hasOwnProperty.call(
            exports,
            name
            )
        ) {
            return;
        }


        Object.defineProperty(
            exports,
            name,
            {
            enumerable:
                true,

            configurable:
                false,

            get:
                getter,
            }
        );
        }


        /**
         * export * from ...
         */
        function __vliReExport(
        target,
        source
        ) {

        Object.keys(
            source
        ).forEach(
            (name) => {

            if (
                name === 'default'
            ) {
                return;
            }


            __vliExportGetter(
                target,
                name,
                () => source[name]
            );
            }
        );
        }


        /**
         * Internal bundle module loader.
         */
        function __vliRequire(moduleId) {

            console.log("[VLI RUNTIME] Require:", moduleId);

            const cached =
                __vliModuleCache[
                moduleId
                ];


            if (
                cached
            ) {
                return cached.exports;
            }


            const factory = __vliModules[moduleId];


            if (!factory) {

                throw new Error(
                '[VLI BUNDLE] Module not found: ' +
                moduleId
                );
            }


            /**
             * Cache BEFORE executing.
             *
             * This prevents infinite recursion for
             * circular module relationships.
             */
            const module = {
                exports:
                {},
            };

            console.log(
                "[VLI RUNTIME] Module exports:",
                {
                    id : moduleId,
                    exports:module.exports,
                }
            );


            __vliModuleCache[moduleId] =
                module;


            factory(
                module,
                module.exports,
                __vliRequire,
                __vliExportGetter,
                __vliReExport
            );

            console.log(
                "[VLI RUNTIME] Require returning:",
                {
                    id : moduleId,
                    value:
                        module.exports,
                }
            );

            return module.exports;
        }


        /**
         * Start application.
         */
        __vliRequire(
        ${JSON.stringify(entryId)}
        );
    `;

  console.log(
    "[VLI BUNDLE] Modules bundled:",
    bundleGraph.getModuleIds().length,
  );

  console.log(
    "[VLI BUNDLE] Bundle size:",
    Buffer.byteLength(bundle, "utf8"),
    "bytes",
  );

  console.log("[VLI BUNDLE] ✅ Bundle generated");

  console.log("======================================");

  return bundle;
}

module.exports = {
  generateStaticBundle,
};
