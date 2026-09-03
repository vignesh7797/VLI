const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { watchProject } = require("./watcher");
const { ModuleGraph } = require("./module-graph");
const { getHmrRuntimeScript } = require("./hmr-runtime");

const PORT = 7000;

/**
 * Basic MIME type mapping.
 */
const mimeTypes = {
  ".html": "text/html; charset=utf-8",

  ".css": "text/css; charset=utf-8",

  ".js": "text/javascript; charset=utf-8",

  ".json": "application/json; charset=utf-8",

  ".svg": "image/svg+xml",

  ".png": "image/png",

  ".jpg": "image/jpeg",

  ".jpeg": "image/jpeg",

  ".gif": "image/gif",

  ".ico": "image/x-icon",
};

function rewriteImportUrls(code, moduleId, moduleVersions) {
  console.log("[VLI TRANSFORM] Rewriting imports for:", moduleId);

  function rewriteSpecifier(importPath) {
    const dependencyId = resolveBrowserImport(moduleId, importPath);

    if (!dependencyId) {
      console.log("[VLI TRANSFORM] Leaving import unchanged:", importPath);

      return importPath;
    }

    const version = getModuleVersion(moduleVersions, dependencyId);

    console.log("[VLI VERSION]", dependencyId);

    const rewritten = dependencyId + "?vli=" + version;

    console.log("[VLI TRANSFORM] Import rewrite", importPath, "->", rewritten);

    return rewritten;
  }

  code = code.replace(
    /(\bimport\s+[\s\S]*?\s+from\s+['"])([^'"]+)(['"])/g,
    (match, start, importPath, end) => {
      return start + rewriteSpecifier(importPath) + end;
    },
  );

  code = code.replace(
    /(\bimport\s+['"])([^'"]+)(['"])/g,
    (match, start, importPath, end) => {
      return start + rewriteSpecifier(importPath) + end;
    },
  );

  return code;
}

/**
 * ==================================
 * JS TRANSFORMATION
 * ==================================
 */
function transformJavaScript(code, requestPath, moduleVersions) {
  const moduleId = "/" + requestPath.replace(/\\/g, "/");

  console.log("[VLI TRANSFORM] Transforming:", moduleId);

  let transformedCode = rewriteImportUrls(code, moduleId, moduleVersions);

  transformedCode = transformedCode.replaceAll(
    "import.meta.vli.hot",
    "__vliHot",
  );

  const hotContext = `
    const __vliHot = globalThis.__VLI_HMR__?.createHotContext(${JSON.stringify(moduleId)});
    console.log('[VLI MODULE] Loaded:', ${JSON.stringify(moduleId)});
  `;

  return hotContext + transformedCode;
}

/**
 * ==================================
 * INJECT VLI CLIENT
 * ==================================
 */

function injectLiveReload(html) {
  const hmrRuntime = getHmrRuntimeScript();

  const clientScript = `
    <script type="module">

      console.log("[VLI CLIENT] Starting browser runtime");

      /**
       * =================================
       * SSE CONNECTION
       * =================================
       */

      const vliReload = new EventSource("/__vli_reload");

      globalThis.__VLI_SSE__ = vliReload;

      vliReload.onopen = function () {
        console.log("[VLI SSE] Conncted.");
      };

      vliReload.onerror = function (error) {
        console.error("[VLI SSE] Error:", error);
        console.log("[VLI SSE] readyState:", vliReload.readyState);
      };

      vliReload.onmessage = async function (event) {

        console.log("[VLI SSE] Raw message:", event.data);

        let message;

        try {
          message = JSON.parse(event.data);
        } catch (error) {
          console.error("[VLI SSE] Invalid JSON:", error);
          return;
        }

        console.log("[VLI SSE] Parsed message:", message);

        /**
         * CSS UPDATE
         */

        if (message.type === "css-update") {
          console.log("[VLI SSE] CSS update:", message.file);

          reloadCss(message.file);
          return;
        }

        /**
         * HTML UPDATE
         */

        if (message.type === "html-update") {
          console.log("[VLI SSE] HTML update:", message.file);
          await reloadHtml(message.file);

          return;
        }

        /**
         * JavaScript HMR
         */
        if (message.type === "js-update") {
          console.log("[VLI SSE] JS update:", message.file);

          console.log("[VLI SSE] Changed module version:", {
            moduleId: message.moduleId,
            version: message.version
          })

          console.log("[VLI SSE] Propagation paths:", message.propagationPaths);

          await reloadJs(message.file, message.propagationPaths);

          return;
        }

        /**
         * Full Reload fallback
         */

        if (message.type === "reload") {
          console.log("[VLI] Full reload requested");

          window.location.reload();
        }
      };

      /**
       * ===============================
       * FIND HMR BOUNDARY
       * ===============================
       *
       * Example path:
       *
       * [
       *    '/js/math.js',
       *    '/js/counter.js',
       *    'script.js'
       * ]
       *
       * we inspect:
       *
       * counter.js accepts math.js?
       * script.js accepts counter.js?
       */

      function fallbackToReload(reason, details = null) {

        console.error("[VLI HMR FALLBACK]", reason, details);
        
        window.location.reload();
      }

      function findHmrBoundaries(hmr, propagationPaths) {

        const boundaries = [];

        const unsafePaths = [];

        const seenBoundaries = new Set();

        for (const path of propagationPaths) {

          const modules = path?.modules;

          const cyclic = path?.cyclic === true;

          if (!Array.isArray(modules)) {

            unsafePaths.push({
              modules,
              cyclic,
              reason: 'INVALID_PATH',
            });

            continue;
          }

          let boundaryFound = false;

          for (let index = 0; index < modules.length - 1; index++) {

            const dependencyId = modules[index];

            const importerId = modules[index + 1];

            const accepted = hmr.acceptsDependency(importerId, dependencyId);

            if (!accepted) {
              continue;
            }

            boundaryFound = true;

            const boundaryKey = importerId + '::' + dependencyId;

            if(seenBoundaries.has(boundaryKey)){

              break;
            }

            seenBoundaries.add(boundaryKey);

            const boundary = {
              key: boundaryKey,
              boundaryId : importerId,
              dependencyId,
              updateModuleId: dependencyId,
              path: modules,
              cyclic,
            };

            boundaries.push(boundary);

            break;
          }

          if(!boundaryFound) {

            unsafePaths.push({
              modules, 
              cyclic,
              reason : cyclic ? 'CYCLIC_NO_BOUNDARY' : 'NO_BOUNDARY',
            });

          } 
        }

        return {
          boundaries,
          unsafePaths
        };
      }

      /**
       * =========================================
       * JAVASCRIPT HME
       * =========================================
       */

      async function reloadJs(changedFile, propagationPaths = []) {


        const changedModuleId = "/" + changedFile;

        const hmr = globalThis.__VLI_HMR__;

        if (!hmr) {
          console.log("[VLI HMR] Runtime missing");
          window.location.reload();
          return;
        }

        /**
         * =================================
         * CASE 1:
         * SELF ACCEPTING MODULE
         * =================================
         */
        const selfAccepted = hmr.isAccepted(changedModuleId);

        console.log("[VLI HMR] Self accepted?", selfAccepted);

        if (selfAccepted) {
          console.log("[VLI HMR] Running Self HMR:", changedModuleId);

          try {
            console.log("[VLI HMR] Disposing:", changedModuleId);

            await hmr.disposeModule(changedModuleId);

            const updateUrl = changedModuleId + "?vli=" + Date.now();

            console.log("[VLI HMR] Importing:", updateUrl);

            const newModule = await import(updateUrl);

            console.log("[VLI HMR] Self HMR complete:", changedModuleId);
            console.log("[VLI HMR] New module:", newModule);

            return;
          } catch (error) {
            console.error("[VLI HMR] Self HMR failed:", error);

            fallbackToReload("JS module update failed", {
              moduleId,
              error:error.message
            });

            window.location.reload();
            return;
          }
        }

        /**
         * =================================
         * MULTI BRANCH PROPAGATION
         * =================================
         */
        console.log("[VLI HMR] Starting multi-branch propagation");

        const analysis = findHmrBoundaries(hmr, propagationPaths);

        const {boundaries, unsafePaths} = analysis;

        console.log("[VLI HMR] Analysis result:", analysis);


        /**
         * =================================
         * SAFETY CHECK
         * =================================
         */

        if(unsafePaths.length > 0) {
          fallbackToReload('At least one propagation branch has no boundary', {
              changedModuleId,
              unsafePaths,
              boundaries
          });

          return;
        }

        /** 
        * if (boundaries.length === 0) {
        *   fallbackToReload('no HMR boundaries were found', {
        *       changedModuleId,
        *       propagationpaths
        *   });  
        *  return;
        * }
        */

        console.log("[VLI HMR] ALL branches are safe");

        console.log("[VLI HMR] Boundary count:", boundaries.length);

        /**
         * =================================
         * APPLY EVERY BOUNDARY
         * =================================
         */

        for(let index = 0; index < boundaries.length; index++) {

          const boundary = boundaries[index];

          const { boundaryId, dependencyId, updateModuleId, path } = boundary;

          console.log("[VLI HMR] Processing boundary:", index+1, '/', boundaries.length);

          console.log("[VLI HMR] Boundary:", boundary);

          try {

            /**
             * ----------------------
             * Check callback FIRST
             * ----------------------
            */
            const callback = hmr.getDependencyCallback(boundaryId, dependencyId);

            console.log("[VLI HMR] Callback lookup:", {
              boundaryId, 
              dependencyId,
              callback
            });

            if (typeof callback !== "function") {
              fallbackToReload('Dependency boundary exists but callback is missing', boundary);
              return;
            } 

            /**
             * ----------------------
             * DISPOSING
             * ----------------------
            */
            console.log("[VLI HMR] Disposing:", updateModuleId);

            await hmr.disposeModule(updateModuleId);

            console.log("[VLI HMR] Dispose complete:", updateModuleId);

            const updateUrl = updateModuleId + "?vli_hmr=" + Date.now() + '_'+ index;

            console.log("[VLI HMR] Importing fresh module:", updateUrl);

            const newModule = await import(updateUrl);

            console.log("[VLI HMR] Fresh modul imported:", updateModuleId);

            console.log("[VLI HMR] Fresh modul exports:", newModule);

            console.log("[VLI HMR] Running callback:", boundaryId, '<-', dependencyId);

            await callback(newModule);

            console.log("[VLI HMR] Callback complete:", boundaryId);

          } catch (error) {

            console.error("[VLI HMR] Boundary execution failed:", boundary);

            console.error("[VLI HMR] Boundary:", boundary);

            console.error("[VLI HMR] Error:",error);

            fallbackToReload('Execution while applying HMR boundary', {
              boundary, error
            })

            return;
          }

        }

        console.log("[VLI HMR] All Branches updated");

        console.log("[VLI HMR] changes module:", changedModuleId);
        
      }

      /**
       * =========================================
       * CSS HME
       * =========================================
       */
      function reloadCss(changedFile) {

        const links = document.querySelectorAll('link[rel="stylesheet"]');

        links.forEach((link) => {
          const url = new URL(link.href, window.location.href);

          const stylesheetPath = url.pathname.startsWith("/")
            ? url.pathname.slice(1)
            : url.pathname;

          if (stylesheetPath.endsWith(changedFile)) {
            url.searchParams.set("vli", Date.now());

            link.href = url.toString();

            console.log("[VLI CSS] updated:", changedFile);
          }
        });
      }

      /**
       * =========================================
       * HTML HOT UPDATE
       * =========================================
       */
      async function reloadHtml(changedFile) {

        const pathname = window.location.pathname;

        const currentPage =
          pathname === "/"
            ? "index.html"
            : pathname.startsWith("/")
              ? pathname.slice(1)
              : pathname;

        if (currentPage !== changedFile) {
          console.log("[VLI HTML] Changed page is not current page");
          return;
        }

        try {
          const response = await fetch(window.location.href, {
            cache: "no-store",
          });

          if (!response.ok) {
            console.error("[VLI HTML] Failed to fetch updated HTML.");

            return;
          }

          const updatedHTML = await response.text();

          const parser = new DOMParser();

          const newDocument = parser.parseFromString(updatedHTML, "text/html");

          document.title = newDocument.title;

          document.body.innerHTML = newDocument.body.innerHTML;

          console.log("[VLI HTML] updated:", changedFile);
        } catch (error) {
          console.error("[VLI HTML] update failed:", error);

          window.location.reload();
        }
      }


    </script>
    `;

  /**
   * HMR runtime must execute BEFORE application modules.
   */

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${hmrRuntime}</head>`);
  } else {
    html = hmrRuntime + html;
  }

  /**
   * Browser client goes at bottom of body
   */
  if (html.includes("</body>")) {
    html = html.replace("</body>", `${clientScript}</body>`);
  } else {
    html += clientScript;
  }

  return html;
}

/**
 * ====================================
 * SEND SSE MESSAGE
 * ====================================
 */

function sendMessage(clients, message) {
  console.log("[VLI SERVER] sending message:", message);
  console.log("[VLI SERVER] Connected clients:", clients.length);

  const data = JSON.stringify(message);

  clients.forEach((client, index) => {
    console.log("[VLI SERVER] Sending to client:", index);

    client.write(`data: ${data}\n\n`);
  });
}

/**
 * ====================================
 * OPEN BROWSER
 * ====================================
 */
function openBrowser(url) {
  let command;

  if (process.platform === "win32") {
    command = `start ${url}`;
  } else if (process.platform === "darwin") {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log(`Open manually: ${url}`);
    }
  });
}

function getModuleVersion(moduleVersions, moduleId) {
  return moduleVersions.get(moduleId) ?? 0;
}

function bumpModuleVersion(moduleVersions, moduleId) {
  const currentVersion = getModuleVersion(moduleVersions, moduleId);

  const nextVersion = currentVersion + 1;

  moduleVersions.set(moduleId, nextVersion);

  console.log(
    "[VLI VERSION] Bumped:",
    moduleId,
    currentVersion,
    "->",
    nextVersion,
  );

  return nextVersion;
}

function resolveBrowserImport(importerId, importPath) {
  if (!importPath.startsWith(".")) return null;

  const importerDirectory = path.posix.dirname(importerId);

  const resolved = path.posix.normalize(
    path.posix.join(importerDirectory, importPath),
  );

  const moduleId = resolved.startsWith("/") ? resolved : "/" + resolved;

  console.log("[VLI IMPORT] Resolved:", {
    importerId,
    importPath,
    moduleId,
  });

  return moduleId;
}

/**
 * ====================================
 * START DEV SERVER
 * ====================================
 */
function startDevServer() {
  const projectRoot = process.cwd();

  const moduleGraph = new ModuleGraph();

  const moduleVersions = new Map();

  const clients = [];

  const indexPath = path.join(projectRoot, "index.html");

  if (!fs.existsSync(indexPath)) {
    console.error("[VLI] index.html not found");

    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    console.log("[VLI SERVER] Request url:", req.url);

    /**
     * ===========================
     * SSE ENDPOINT
     * ==========================
     */
    if (req.url === "/__vli_reload") {
      console.log("[VLI SSE] Browser connecting...");

      res.writeHead(200, {
        "Content-Type": "text/event-stream",

        "Cache-Control": "no-cache",

        Connection: "keep-alive",
      });

      res.flushHeaders?.();

      clients.push(res);

      console.log("[VLI SSE] Client added. Total:", clients.length);

      res.write(": connected\n\n");

      req.on("close", () => {
        const index = clients.indexOf(res);

        if (index !== -1) {
          clients.splice(index, 1);
        }

        console.log("[VLI SSE] client disconnected. Total:", clients.length);
      });

      return;
    }

    const cleanUrl = req.url.split("?")[0];

    let requestPath =
      cleanUrl === "/"
        ? "index.html"
        : cleanUrl.startsWith("/")
          ? cleanUrl.slice(1)
          : cleanUrl;

    requestPath = decodeURIComponent(requestPath);

    const filePath = path.resolve(projectRoot, requestPath);

    const relativePath = path.relative(projectRoot, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.writeHead(403, {
        "content-type": "text/plain",
      });

      res.end("403 - Forbidden");

      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404, { "content-type": "text/plain" });

        res.end("Not Found");

        return;
      }

      const extension = path.extname(filePath).toLowerCase();

      /**
       * HTML
       */

      if (extension == ".html") {
        const html = injectLiveReload(content.toString());

        res.writeHead(200, {
          "content-type": mimeTypes[extension],
          "cache-control": "no-cache",
        });

        res.end(html);

        return;
      }

      /**
       * JavaScript
       */
      if (extension == ".js") {
        const sourceCode = content.toString();

        const moduleId = "/" + requestPath.replace(/\\/g, "/");

        console.log("[VLI GRAPH] Updating module:", moduleId);

        moduleGraph.updateModule(moduleId, sourceCode);

        console.log("[VLI GRAPH] Current graph:", moduleGraph.inspect());

        const transformedCode = transformJavaScript(
          sourceCode,
          requestPath,
          moduleVersions,
        );

        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        });

        res.end(transformedCode);

        return;
      }

      /**
       * Everything else
       */

      res.writeHead(200, {
        "content-type": mimeTypes[extension] || "application/octet-stream",
        "cache-control": "no-cache",
      });

      res.end(content);
    });
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;

    console.log("[VLI] Dev Server:", url);

    openBrowser(url);
  });

  /**
   * ========================================
   * FILE WATCHER
   * ========================================
   */
  watchProject(projectRoot, ({ eventType, file }) => {
    try {
      console.log("[VLI WATCHER]", eventType, file);

      const extension = path.extname(file).toLowerCase();

      /**
       * CSS
       */
      if (extension == ".css") {
        sendMessage(clients, { type: "css-update", file });
        return;
      }

      /**
       * HTML
       */
      if (extension === ".html") {
        sendMessage(clients, { type: "html-update", file });
        return;
      }

      /**
       * JS
       */

      if (extension === ".js") {
        const moduleId = "/" + file.replace(/\\/g, "/");

        console.log("[VLI HMR SERVER] Changed:", moduleId);

        const version = bumpModuleVersion(moduleVersions, moduleId);

        console.log("[VLI HMR SERVER] New Version:", version);

        const propagationPaths = moduleGraph.findPropagationPaths(moduleId);

        console.log("[VLI HMR SERVER] propagation paths:", propagationPaths);

        sendMessage(clients, {
          type: "js-update",
          file,
          moduleId,
          version,
          propagationPaths,
        });

        return;
      }

      /** Other files */
      sendMessage(clients, { type: "reload", file });
    } catch (error) {
      console.error("[VLI ERROR] File update failed:", file, error);
      
      sendMessage(clients, {type: 'full-reload', reason:'SERVER_HMR_ERROR'})
    }
  });
}

module.exports = {
  startDevServer,
};
