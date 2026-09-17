/**
 * VLI CSS Bundler — B2.4.2
 *
 * Takes CSS modules already discovered in
 * BundleGraph and combines them into one
 * production stylesheet.
 *
 * url(...) asset processing comes in B2.4.3.
 */

/**
 * Remove local @import declarations.
 *
 * Those files have already been resolved and
 * will be emitted directly into the bundle.
 *
 * External @imports remain untouched.
 */
function removeLocalCssImports(code) {
    return code.replace(
        /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/gi,

        (match, importPath) => {
            const isExternal =
                importPath.startsWith("http://") ||
                importPath.startsWith("https://") ||
                importPath.startsWith("//");

            const isRelative = importPath.startsWith(".");

            /**
             * External imports stay in CSS.
             */
            if (isExternal) {
                console.log("[VLI CSS BUNDLE] External @import preserved:", importPath);

                return match;
            }

            /**
             * Relative imports have already been
             * added to BundleGraph.
             *
             * Remove the @import statement because
             * its contents will be bundled.
             */
            if (isRelative) {
                console.log("[VLI CSS BUNDLE] Local @import extracted:", importPath);

                return "";
            }

            /**
             * Unknown/non-relative imports are
             * preserved for now.
             */
            return match;
        },
    );
}

/**
 * Collect CSS in dependency-first order.
 *
 * Example:
 *
 * app.css
 *   ├── base.css
 *   └── button.css
 *
 * Result:
 *
 * base.css
 * button.css
 * app.css
 */
function collectCssOrder(bundleGraph) {
    const ordered = [];

    const visited = new Set();

    function visit(moduleId) {
        if (visited.has(moduleId)) {
            return;
        }

        visited.add(moduleId);

        const moduleRecord = bundleGraph.getModule(moduleId);

        if (!moduleRecord) {
            console.warn("[VLI CSS BUNDLE] Missing graph module:", moduleId);

            return;
        }

        /**
         * Traverse CSS dependencies first.
         */
        for (const dependencyId of moduleRecord.imports) {
            const dependency = bundleGraph.getModule(dependencyId);

            if (dependency && dependency.type === "css") {
                visit(dependencyId);
            }
        }

        if (moduleRecord.type === "css") {
            ordered.push(moduleId);
        }
    }

    /**
     * Start from CSS modules imported by JS.
     *
     * This prevents accidentally bundling
     * unrelated CSS graph nodes.
     */
    for (const moduleId of bundleGraph.getModuleIds()) {
        const moduleRecord = bundleGraph.getModule(moduleId);

        if (!moduleRecord || moduleRecord.type !== "js") {
            continue;
        }

        for (const dependencyId of moduleRecord.imports) {
            const dependency = bundleGraph.getModule(dependencyId);

            if (dependency && dependency.type === "css") {
                visit(dependencyId);
            }
        }
    }

    return ordered;
}

function rewriteCssAssetUrls({ code, moduleId, assetManager }) {
    return code.replace(
        /url\(\s*(["']?)([^"'()]+)\1\s*\)/gi,

        (fullMatch, quote, assetPath) => {
            const value = assetPath.trim();

            /**
             * Ignore URLs that should not
             * become build assets.
             */
            if (
                !value ||
                value.startsWith("data:") ||
                value.startsWith("http://") ||
                value.startsWith("https://") ||
                value.startsWith("//") ||
                value.startsWith("#")
            ) {
                console.log("[VLI ASSET] CSS URL preserved:", value);

                return fullMatch;
            }

            /**
             * B2.4.3 handles relative assets.
             */
            if (!value.startsWith(".")) {
                console.log("[VLI ASSET] Non-relative CSS URL preserved:", value);

                return fullMatch;
            }

            const asset = assetManager.register({
                importerId: moduleId,

                assetPath: value,
            });

            if (!asset) {
                return fullMatch;
            }

            /**
             * style.css itself lives inside:
             *
             * dist/assets/style.css
             *
             * Assets also live in:
             *
             * dist/assets/
             *
             * Therefore style.css should use:
             *
             * url("./logo.png")
             *
             * NOT:
             *
             * url("./assets/logo.png")
             */
            const rewrittenUrl = `./${asset.fileName}`;

            console.log("[VLI ASSET] CSS URL rewrite:", {
                module: moduleId,

                source: value,

                output: rewrittenUrl,
            });

            return `url(${JSON.stringify(rewrittenUrl)})`;
        },
    );
}

/**
 * Generate one CSS production bundle.
 */
function generateCssBundle({bundleGraph, assetManager}) {
    console.log("======================================");

    console.log("[VLI CSS BUNDLE] Generating CSS bundle");

    const orderedModules = collectCssOrder(bundleGraph);

    console.log("[VLI CSS BUNDLE] Bundle order:", orderedModules);

    if (orderedModules.length === 0) {
        console.log("[VLI CSS BUNDLE] No application CSS found");

        console.log("======================================");

        return null;
    }

    const output = [];

    for (const moduleId of orderedModules) {
        const moduleRecord = bundleGraph.getModule(moduleId);

        console.log("[VLI CSS BUNDLE] Adding:", moduleId);

        let css = removeLocalCssImports(moduleRecord.code);

        css = rewriteCssAssetUrls({code:css, moduleId, assetManager});
        /**
         * Keep module markers for now.
         *
         * Very useful while debugging generated
         * production CSS.
         */
        output.push(`/* VLI CSS MODULE: ${moduleId} */\n${css.trim()}`);
    }

    const bundle = output.join("\n\n") + "\n";

    console.log("[VLI CSS BUNDLE] Modules bundled:", orderedModules.length);

    console.log(
        "[VLI CSS BUNDLE] Bundle size:",
        Buffer.byteLength(bundle, "utf8"),
        "bytes",
    );

    console.log("[VLI CSS BUNDLE] ✅ CSS bundle generated");

    console.log("======================================");

    return bundle;
}

module.exports = {
    generateCssBundle,
};
