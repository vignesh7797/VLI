function getHmrRuntimeScript() {
    return `
          <script type="module">
              if(!globalThis.__VLI_HMR__) {
                  const modules = new Map();
  
                  /**
                   * Get existing module record or create it.
                   */
  
                  function getModuleRecord(moduleId) {
                      let record = modules.get(moduleId);
  
                      if(!record) {
                      record = {
                          id: moduleId,
                          accepted : false, 
                          data : {},
                          disposeCallbacks : [],
                          generation : 0,
                          dependencyAccepts: new Map(),
                      };
  
                      modules.set(moduleId, record);
                      }
                      return record;
                  }
  
                  function resolveDependencyId(importerId, dependency) {
                      if(!dependency.startsWith('.')){
                          return dependency;
                      }
  
                      const importerUrl = new URL(importerId, window.location.origin);
  
                      const resolvedUrl = new URL(dependency, importerUrl);
  
                      return resolvedUrl.pathname;
                  }
  
                  /**
                   * Create the public import.meta.vli.hot context.
                   */
  
                  function createHotContext(moduleId) {
                      const record = getModuleRecord(moduleId);
  
                      /**
                       * Safety guard.
                       */
  
                      if(!record) {
                      console.error('[VLI] Failed to create HMR', moduleId);
  
                      return null;
                      }
  
                      record.generation++;
  
                      /**
                       * New module version needs to accept HMR again.
                       */
  
                      record.accepted = false;
  
                      return {
                      data : record.data,
                      accept(dependency, callback) {
  
  
                          console.log('[VLI] hot.accept called:', {
                              moduleId, dependency, callback,
                          });
  
                          if(dependency === undefined) {
                              record.accepted = true;
                              return;
                          }
  
                          if(typeof dependency === 'string') {
                              const dependencyId = resolveDependencyId(moduleId, dependency);
  
                              console.log('[VLI] registering dependency accept:', moduleId, 'accepts', dependencyId);
  
                              record.dependencyAccepts.set(dependencyId, callback);
  
                              return;
                          }
  
                          console.warn('[VLI] Unsupported hot.accept() usage:', moduleid)
                      },
                      dispose(callback) {
                          if(typeof callback !== 'function') {
                          console.warn('[VLI] dispose() expects a function:', moduleId);
                          return;
                          }
  
                          record.disposeCallbacks.push(callback);
                      },
                      invalidate() {
                          console.log('[VLI] HMR invalidated:', moduleId);
                          window.location.reload();
                      },
                      get id() {
                          return record.id;
                      },
  
                      get generation() {
                          return record.generation;
                      },
                      };
                  }
  
                  /**
                   *  RUn cleanup callbacks before replacing module.
                   */
  
                  async function disposeModule(moduleId) {
                      const record = modules.get(moduleId);
  
                      if(!record) {
                      return;
                      }
  
                      const callbacks = [...record.disposeCallbacks];
  
                      /**
                       * Clear old callbacks before the new module registers its callbacks.
                       */
  
                      record.disposeCallbacks = [];
  
                      for(const callback of callbacks) {
                      try {
                          await callback(record.data);
                      } catch (error) {
                          console.error('[VLI] Dispose Failed:', moduleId, error);
                      }
                      }
                  }
  
                  function isAccepted(moduleId) {
                      const record = modules.get(moduleId);
  
                      return Boolean(record?.accepted);
                  }
  
                  /**
                   * Development helper
                   */
                  function inspect() {
                      const result = [];
  
                      for(const [id, record] of modules){
                      result.push({
                          id, 
                          accepted : record.accepted, 
                          generation:record.generation, 
                          data:record.data,
                          disposeCallbacks: record.disposeCallbacks.length,
                      });
                      }
  
                      console.table(result);
  
                      return result;
                  }
  
                  function acceptsDependency(importerId, dependencyId) {
                      const record = modules.get(importerId);
  
                      if(!record) {
                          return false;
                      }
  
                      return record.dependencyAccepts.has(dependencyId);
                  }
  
                  function getDependencyCallback(importerId, dependencyId) {
                      const record = modules.get(importerId);
  
                      if(!record) {
                          return undefined;
                      }
  
                      return record.dependencyAccepts.get(dependencyId);
                  }
  
                  /**
                   * Public VLU HMR runtime.
                   */
  
                  globalThis.__VLI_HMR__ = {
                      modules, 
                      getModuleRecord, 
                      createHotContext,
                      disposeModule,
                      isAccepted,
                      acceptsDependency,
                      getDependencyCallback,
                      inspect,
                  };
  
                  console.log('[VLI] HMR runtime initialized.')
              }
          </script>
      `;
}

module.exports = {
    getHmrRuntimeScript,
}




