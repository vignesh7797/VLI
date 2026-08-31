const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { getHmrRuntimeScript } = require("./hmr-runtime");

const { watchProject } = require("./watcher");
const console = require("console");
const { ModuleGraph } = require("./module-graph");

const PORT = 3000;

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
 * Inject VLI hot reload runtime
 * into HTML before sending
 * it to browser.
 */
function injectLiveReload(html) {
  const hmrRuntime = getHmrRuntimeScript();

  const clientScript = `
<script type="module">

  console.log('[VLI] Client runtime starting');

  const vliReload =
    new EventSource(
      '/__vli_reload'
    );

  globalThis.__VLI_SSE__ = vliReload;

  console.log('[VLI] EventSource created.');

  vliReload.onopen = function () {
    console.log('[VLI] SSE conncted.');
  };

  vliReload.onerror = function (error) {
    console.error('[VLI] SSR error:', error);
    console.log('[VLI] SSE readyState:', vliReload.readyState);
  };

  vliReload.onmessage =
    async function (event) {
      console.log('[VLI] SSE message:', event.data);

      const message =
        JSON.parse(
          event.data
        );
      
      if (
        message.type ===
        'css-update'
      ) {
        reloadCss(
          message.file
        );

        return;
      }

      if (
        message.type ===
        'html-update'
      ) {
        await reloadHtml(
          message.file
        );

        return;
      }

      if (
        message.type ===
        'js-update'
      ) {
        console.log('[VLI] JS update received', message.file);
        await reloadJs(message.file, message.chain);

        return;
      }

      if (
        message.type ===
        'reload'
      ) {
        window.location.reload();
      }
    };


  /**
   * CSS HOT RELOAD
   *
   * Does not reload page.
   */
  function reloadCss(
    changedFile
  ) {
    const links =
      document.querySelectorAll(
        'link[rel="stylesheet"]'
      );

    links.forEach(
      (link) => {

        const url =
          new URL(
            link.href,
            window.location.href
          );

        /**
         * Avoid regex escaping
         * issue inside injected
         * template string.
         */
        const stylesheetPath =
          url.pathname.startsWith('/')
            ? url.pathname.slice(1)
            : url.pathname;

        if (
          stylesheetPath.endsWith(
            changedFile
          )
        ) {
          /**
           * Add changing query
           * parameter to bypass
           * browser cache.
           */
          url.searchParams.set(
            'vli',
            Date.now()
          );

          link.href =
            url.toString();

          console.log(
            '[VLI] CSS updated:',
            changedFile
          );
        }
      }
    );
  }


  /**
   * HTML HOT UPDATE
   *
   * Fetch current page again
   * and replace body DOM.
   */
  async function reloadHtml(
    changedFile
  ) {

    const pathname =
      window.location.pathname;

    const currentPage =
      pathname === '/'
        ? 'index.html'
        : pathname.startsWith('/')
          ? pathname.slice(1)
          : pathname;

    /**
     * Don't update current page
     * when a different HTML file
     * was edited.
     */
    if (
      currentPage !==
      changedFile
    ) {
      return;
    }

    try {

      const response =
        await fetch(
          window.location.href,
          {
            cache:
              'no-store',
          }
        );

      if (
        !response.ok
      ) {
        console.error(
          '[VLI] Failed to fetch updated HTML.'
        );

        return;
      }

      const html =
        await response.text();

      const parser =
        new DOMParser();

      const newDocument =
        parser.parseFromString(
          html,
          'text/html'
        );

      /**
       * Update title.
       */
      document.title =
        newDocument.title;

      /**
       * Replace body content.
       *
       * We intentionally don't
       * replace the complete
       * document.
       */
      document.body.innerHTML =
        newDocument.body.innerHTML;

      console.log(
        '[VLI] HTML updated:',
        changedFile
      );

    } catch (error) {

      console.error(
        '[VLI] HTML update failed:',
        error
      );

      /**
       * Safe fallback.
       */
      window.location.reload();
    }
  }


  /**
   * BASIC JS HOT RELOAD
   *
   * This is currently
   * hot re-importing,
   * not full Vite-like HMR.
   */
  async function reloadJs(changedFile, chain = []) {
    console.log('[VLI] reloadJs called:', changedFile);

    const changedModuleId = '/' + changedFile;

    const hmr = globalThis.__VLI_HMR__;

    console.log('[VLI] JS HMR update:', changedModuleId);

    console.log('[VLI] Propogation chain:', chain);

    /**
     * Runtime unavailable.
     * Safest fallback: full reload.
    */
    if(!hmr) {
      console.log('[VLI] HMR runtime unavailable')
      window.location.reload();
      return;
    }

    /**
     * =================================
     * CASE 1:
     * Changes module accepts itself.
     * =================================
    */
    if(hmr.isAccepted(changedModuleId)) {
      console.log('[VLI] Self-accepted module:', changedModuleId);

      try{
        await hmr.disposeModule(changedModuleId);

        const newModule = await import(changedModuleId + '?vli=' + Date.now());

        console.log('[VLI] Self HMR complete:', changedModuleId, newModule);

        return;
      } catch(error) {
        console.error('[VLI] Self HMR failed:', error);
        
        window.location.reload();
        return;
      }
    }


    /**
     * =================================
     * CASE 2:
     * Search importer boundry.
     * =================================
    */

    for(const node of chain){
      for(const importerId of node.importers || []) {
        console.log('[VLI] Checking boundry:', importerId, 'accepts', node.id);;
      
        const accepts = hmr.acceptsDependency(importerId, node.id);

        if(!accepts) {
          continue;
        }

        console.log('[VLI] HMR boundry found:', importerId, 'accepts', node.id);;

        try {
          await hmr.disposeModule(changedModuleId);

          const newModule = await import(changedModuleId + '?vli=' + Date.now());

          const callback = hmr.getDependencyCallback(importerId, node.id);

          if(typeof callback === 'function') {
            await callback(newModule);
          }

          console.log('[VLI] Dependency HMR complete:', changedModuleId);

          return;
          
        } catch (error) {
          console.error('[VLI] Dependency HMR failed:', error);
          window.location.reload();
          return;
        }
        
      }
    }



    /**
     * =================================
     * CASE 3:
     * Nobody accepted the update.
     * =================================
    */

    console.log('[VLI] No HMR boundry found.');
    console.log('[VLI] failing back to full reload');
    window.location.reload();
  }

</script>
`;

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${hmrRuntime}</head>`);
  } else {
    html = hmrRuntime + html;
  }

  /**
   * Inject before </body>
   * when possible.
   */
  if (html.includes("</body>")) {
    html = html.replace("</body>", `${clientScript}</body>`);
  } else {
    html += clientScript;
  }

  return html;
}

/**
 * Open default browser.
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
 * Send message to all
 * connected browser clients.
 */
function sendMessage(clients, message) {
  console.log("[VLI] message from sendMessage", message.type);
  const data = JSON.stringify(message);
  console.log("[VLI] changes JS data");
  console.log(data);
  clients.forEach((client) => {
    client.write(`data: ${data}\n\n`);
  });
}

/**
 * Start VLI development server.
 */
function startDevServer() {
  const projectRoot = process.cwd();

  const indexPath = path.join(projectRoot, "index.html");

  const moduleGraph = new ModuleGraph();

  /**
   * Make sure command is
   * being run in project root.
   */
  if (!fs.existsSync(indexPath)) {
    console.error("index.html not found in current directory.");

    console.log('Run "vli run" inside a VLI project.');

    process.exit(1);
  }

  /**
   * Connected SSE clients.
   */
  const clients = [];

  const server = http.createServer((req, res) => {
    /**
     * VLI live reload
     * Server-Sent Events
     * endpoint.
     */
    console.log("[VLI] server request url:", req.url);
    if (req.url === "/__vli_reload") {
      console.log("[VLI] Browser connecting to SSE");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",

        "Cache-Control": "no-cache",

        Connection: "keep-alive",
      });

      /**
       * Keep connection open.
       */
      // res.write("\n");
      res.flushHeaders?.();

      clients.push(res);

      console.log("[VLI] SSE client added. Total:", clients.length);

      res.write(": connected\n\n");

      /**
       * Remove disconnected
       * browser.
       */
      req.on("close", () => {
        const index = clients.indexOf(res);

        if (index !== -1) {
          clients.splice(index, 1);
        }

        console.log("[VLI] SSE client disconnected.");
      });

      return;
    }

    /**
     * Remove query string.
     *
     * Example:
     *
     * style.css?vli=123
     *
     * becomes:
     *
     * style.css
     */
    const cleanUrl = req.url.split("?")[0];

    let requestPath =
      cleanUrl === "/"
        ? "index.html"
        : cleanUrl.startsWith("/")
          ? cleanUrl.slice(1)
          : cleanUrl;

    requestPath = decodeURIComponent(requestPath);

    /**
     * Resoleve Requested file against project root
     */

    const filePath = path.resolve(projectRoot, requestPath);

    /**
     * Security:
     * Prevent:
     * ../../some-file
     * escaping project root
     */

    const relativePath = path.relative(projectRoot, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.writeHead(403, {
        "content-type": "text/plain",
      });

      res.end("403 - Forbidden");

      return;
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" });

        res.end("404 - File not found.");

        return;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          res.writeHead(500, { "content-type": "text/plain" });

          res.end("500 - Server error");

          return;
        }

        const extension = path.extname(filePath).toLowerCase();

        const contentType = mimeTypes[extension] || "application/octet-stream";

        /**
         * Inject VLI runtime only into Html
         */

        if (extension == ".html") {
          const html = injectLiveReload(content.toString());

          res.writeHead(200, {
            "content-type": contentType,
            "cache-control": "no-cache",
          });

          res.end(html);

          return;
        }

        if (extension == ".js") {
          console.log("changes js");

          const sourceCode = content.toString();

          const moduleId = "/" + requestPath.replace(/\\/g, "/");

          moduleGraph.updateModule(moduleId, sourceCode);

          console.log("[VLI] Module graph:", moduleGraph.inspect());

          const transformedCode = transformJavaScript(sourceCode, requestPath);

          res.writeHead(200, {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });

          res.end(transformedCode);

          return;
        }

        /**
         * Serve all other static files
         */

        res.writeHead(200, {
          "content-type": contentType,
          "cache-control": "no-cache",
        });

        res.end(content);
      });
    });
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;

    console.log("");
    console.log("VLI Development Server");
    console.log("");
    console.log(`Local: ${url}`);

    console.log("Watching for changes...");
    console.log("");

    openBrowser(url);
  });

  /**Start VLI's Own filesystem watcher */

  watchProject(projectRoot, ({ eventType, file }) => {
    console.log(`${eventType} : ${file}`);

    const extension = path.extname(file).toLowerCase();

    /**
     * CSS - Hot stylesheet replacement.
     */
    if (extension == ".css") {
      sendMessage(clients, { type: "css-update", file });
      return;
    }

    /**
     * HTML - Hot DOM update
     */
    if (extension === ".html") {
      sendMessage(clients, { type: "html-update", file });
      return;
    }

    /**
     * JS - Hot module import.
     */

    if (extension === ".js") {
      const moduleId = '/' + file.replace(/\\/g, '/');

      const chain = moduleGraph.findImportChain(moduleId);

      console.log('[VLI] HMR propagation chain:', chain)

      console.log("changes JS");
      sendMessage(clients, { type: "js-update", file, chain });
      return;
    }

    /** Other files : full browser reload */
    sendMessage(clients, { type: "reload", file });
  });
}

function transformJavaScript(code, requestPath) {
  const moduleId = "/" + requestPath.replace(/\\/g, "/");

  const hotContext = `
    const __vliHot = globalThis.__VLI_HMR__?.createHotContext(${JSON.stringify(moduleId)});
    console.log('[VLI] registering module:', ${JSON.stringify(moduleId)}, 
    __vliHot)
  `;

  return hotContext + code.replaceAll(`import.meta.vli.hot`, "__vliHot");
}

module.exports = {
  startDevServer,
};
