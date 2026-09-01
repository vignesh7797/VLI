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

/**
 * ==================================
 * JS TRANSFORMATION
 * ==================================
 */
function transformJavaScript(code, requestPath) {
  const moduleId = "/" + requestPath.replace(/\\/g, "/");

  const hotContext = `
    const __vliHot = globalThis.__VLI_HMR__?.createHotContext(${JSON.stringify(moduleId)});
    console.log('[VLI] Registering module:', ${JSON.stringify(moduleId)});
  `;

  return hotContext + code.replaceAll(`import.meta.vli.hot`, "__vliHot");
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
        console.log("-----------------------------------");

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

      function findHmrBoundary(hmr, propagationPaths) {
        console.log("[VLI HMR] Searching boundaries...");
        console.log("[VLI HMR] paths:", propagationPaths);

        if (!Array.isArray(propagationPaths)) {
          console.warn("[VLI HMR] propagationPaths os invalid");
          return null;
        }

        for (const path of propagationPaths) {
          console.log("[VLI HMR] Checking path:", path);

          if (!Array.isArray(path)) {
            continue;
          }

          /**
           * Example:
           * [
           *  math,
           *  counter,
           *  script
           * ]
           *
           * index 0;
           *
           * dependency = math;
           * importer = counter
           */

          for (let index = 0; index < path.length - 1; index++) {
            const dependencyId = path[index];

            const importerId = path[index + 1];

            console.log(
              "[VLI HMR] Checking edge:",
              importerId,
              "accepts",
              dependencyId,
            );

            const accepted = hmr.acceptsDependency(importerId, dependencyId);

            console.log("[VLI HMR] acceptDependency result:", accepted);

            if (!accepted) {
              continue;
            }

            console.log("[VLI HMR] Boundary found:", { importerId, dependencyId });

            return {
              boundaryId : importerId,
              dependencyId,
              updateModuleId : dependencyId,
              path: path,
            };
          }
        }

        console.error("[VLI HMR] No boundary found");
        return null;
      }

      /**
       * =========================================
       * JAVASCRIPT HME
       * =========================================
       */

      async function reloadJs(changedFile, propagationPaths = []) {
        console.log("=============================================");

        console.log("[VLI HMR] reloadJs called");

        const changedModuleId = "/" + changedFile;

        console.log("[VLI HMR] Changes module:", changedModuleId);

        console.log("[VLI HMR] Propagation paths:", propagationPaths);

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
          console.log("[VLI HMR] Runninf Self HMR:", changedModuleId);

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

            window.location.reload();
            return;
          }
        }

        /**
         * =================================
         * CASE 2:
         * PROPAGATE UPWARD
         * =================================
         */
        console.log("[VLI HMR] Module does not aelf-accept.");

        console.log("[VLI HMR] Searching importer boundaries...");

        const boundary = findHmrBoundary(hmr, propagationPaths);

        if (!boundary) {
          console.warn("[VLI HMR] No safe boundary.");
          console.warn("[VLI HMR] Falling back to full");

          window.location.relaod();
          return;
        }

        const { boundaryId, dependencyId, updateModuleId, path } = boundary;
        console.log("[VLI] HMR boundary found:", {
          boundaryId,
          dependencyId,
          updateModuleId,
          path,
        });

        try {
          /**
           * Dispose old version of module being replaced.
           */

          console.log("[VLI HMR] Disposeing update module:", updateModuleId);

          await hmr.disposeModule(updateModuleId);

          /**
           * Import fresh module
           */
          const updateUrl = updateModuleId + "?vli=" + Date.now();

          console.log("[VLI HMR] Importing propagated module:", updateUrl);

          const newModule = await import(updateUrl);

          console.log("[VLI HMR] New Module exports:", newModule);

          /**
           * Get callback registered by the HMR boundary.
           */
          const callback = hmr.getDependencyCallback(boundaryId, dependencyId);

          console.log("[VLI HMR] Depenedendcy callback:", callback);

          if (typeof callback === "function") {
            console.log("[VLI HMR] Running boundary callback");

            await callback(newModule);

            console.log("[VLI HMR] Boundary callback complete");
          } else {
            console.warn("[VLI HMR] BOundary exists but callback missing");
          }

          console.log("[VLI HMR] Propagated HMR complete");

          console.log("[VLI HMR]", changedModuleId, "->", boundaryId);
        } catch (error) {
          console.error("[VLI HMR] Propagated HME failed:", error);

          window.location.reload();
        }
      }

      /**
       * =========================================
       * CSS HME
       * =========================================
       */
      function reloadCss(changedFile) {
        console.log("[VLI CSS] Reloading:", changedFile);

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
        console.log("[VLI HTML] Reloading:", changedFile);

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
  console.log('[VLI SERVER] Connected clients:', clients.length);
  
  const data = JSON.stringify(message);

  clients.forEach((client, index) => {
    console.log('[VLI SERVER] Sending to client:', index);
    
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


/**
 * ====================================
 * START DEV SERVER
 * ====================================
 */
function startDevServer() {
  const projectRoot = process.cwd();

  const moduleGraph = new ModuleGraph();

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

    let requestPath = cleanUrl === "/" ? "index.html" : cleanUrl.startsWith("/") ? cleanUrl.slice(1) : cleanUrl;

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

          console.log('[VLI GRAPH] Updating module:', moduleId);

          moduleGraph.updateModule(moduleId, sourceCode);

          console.log("[VLI GRAPH] Current graph:", moduleGraph.inspect());

          const transformedCode = transformJavaScript(sourceCode, requestPath);

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
          "content-type": mimeTypes[extension] || 'application/octet-stream',
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

    console.log('=====================================');
    
    console.log('[VLI WATCHER]', eventType, file);

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

      const propagationPaths = moduleGraph.findPropagationPaths(moduleId);

      console.log("[VLI HMR SERVER] propagation paths:", propagationPaths);

      sendMessage(clients, { type: "js-update", file, propagationPaths });
      return;
    }

    /** Other files */
    sendMessage(clients, { type: "reload", file });
  });
}

module.exports = {
  startDevServer,
};
