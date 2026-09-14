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

/**
 * Transform ESM imports into our internal
 * bundle runtime calls.
 */
function transformImports({ code, moduleId, moduleResolver }) {
    let importIndex = 0;

    /**
     * import ... from './x'
     */
    code = code.replace(
        /\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g,

        (match, clause, importPath) => {
            const dependencyId = resolveDependency({
                importerId: moduleId,

                importPath,

                moduleResolver,
            });

            console.log("[VLI BUNDLE] Import:", {
                importer: moduleId,

                importPath,

                dependencyId,
            });

            const output = transformImportClause({
                clause,

                dependencyId,

                importIndex,
            });

            importIndex++;

            return output;
        },
    );

    /**
     * Side-effect import:
     *
     * import './setup'
     */
    code = code.replace(
        /\bimport\s+['"]([^'"]+)['"]\s*;?/g,

        (match, importPath) => {
            const dependencyId = resolveDependency({
                importerId: moduleId,

                importPath,

                moduleResolver,
            });

            return `__vliRequire(${JSON.stringify(dependencyId)});`;
        },
    );

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
function transformBundleModule({ moduleId, code, moduleResolver }) {
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
function generateStaticBundle({ bundleGraph, entryId, moduleResolver }) {
    console.log("======================================");

    console.log("[VLI BUNDLE] Generating static bundle");

    console.log("[VLI BUNDLE] Entry:", entryId);

    validateStaticBundle(bundleGraph);

    const factories = [];

    for (const moduleId of bundleGraph.getModuleIds()) {
        const moduleRecord = bundleGraph.getModule(moduleId);

        const transformedCode = transformBundleModule({
            moduleId,

            code: moduleRecord.code,

            moduleResolver,
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
function __vliRequire(
  moduleId
) {

  const cached =
    __vliModuleCache[
      moduleId
    ];


  if (
    cached
  ) {
    return cached.exports;
  }


  const factory =
    __vliModules[
      moduleId
    ];


  if (
    !factory
  ) {

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


  __vliModuleCache[
    moduleId
  ] =
    module;


  factory(
    module,
    module.exports,
    __vliRequire,
    __vliExportGetter,
    __vliReExport
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
