const path = require('path');

class ModuleGraph {
    constructor() {
        this.modules = new Map();
    }

    ensureModule(moduleId){
        let record = this.modules.get(moduleId);

        if(!record) {
            record = {
                id : moduleId,
                imports : new Set(),
                importers : new Set(),
            };

            this.modules.set(moduleId, record);
        }

        return record;
    }

    normalizeModuleid(moduleId) {

        if(typeof moduleId !== 'string' || !moduleId){
            console.error('[VLI] Invalid moduleId:', moduleId);
            return null;
        }

        let normalized = moduleId.replace(/\\/g, '/');

        if(!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }
        return normalized;
    }

    resolveImport(importerId, importPath) {

        console.log('[VLI] resolvement arguments:', arguments);
        

        console.log('[VLI] resolveImport input:', {importerId, importPath});
        
        if(typeof importerId !== 'string' || typeof importPath !== 'string') {
            console.error('[VLI] invalid resolveImport arguments:', {importerId, importPath});
            return null;
        }

        importerId = this.normalizeModuleid(importerId);
        importPath = importPath?.trim();

        console.log('[VLI] Resolving:', {importerId, importPath, startsWithDot: importPath.startsWith('.')});

        if(!importerId || !importPath) {
            return null;
        }

        if(!importPath?.startsWith('.')) {
            return null;
        }

        const importerDirectory = path.posix.dirname(importerId);

        const resolved = path.posix.normalize(path.posix.join(importerDirectory, importPath));

        return this.normalizeModuleid(resolved);
    }

    parseImports(code) {
        const imports = new Set();

        const fromImportRegex = /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;

        let match; 
        
        while ((match = fromImportRegex.exec(code)) !== null) {
            imports.add(match[1].trim());
        } 

        const sideEffectImpoerRegex = /import\s+['"]([^'"]+)['"]/g;

        while ((match = sideEffectImpoerRegex.exec(code)) !== null) {
            imports.add(match[1].trim());
        }
        
        return [...imports];
    }

    updateModule(moduleId, code) {
        moduleId = this.normalizeModuleid(moduleId);

        if(!moduleId) {
            return null;
        }

        const moduleRecord = this.ensureModule(moduleId);

        for(const oldImportId of moduleRecord.imports) {
            const importedModule = this.modules.get(oldImportId);

            importedModule?.importers.delete(moduleId);
        }

        moduleRecord.imports.clear();

        const importPaths = this.parseImports(code);

        console.log('[VLI] parsed imports:', moduleId, importPaths);

        for(const importPath of importPaths) {

            console.log('[VLI] Before resolveImport:', {moduleId, importPath});
                        
            const resolvedImport = this.resolveImport(moduleId, importPath);

            console.log('[VLI] Resolved import:', importPath, '-', resolvedImport);
            

            if(!resolvedImport) {
                continue;
            }

            const importedModule = this.ensureModule(resolvedImport);

            moduleRecord.imports.add(resolvedImport);

            importedModule.importers.add(moduleId);
        }

        return moduleRecord;
    }


    getModule(moduleId) {
        return this.modules.get(this.normalizeModuleid(moduleId));
    }

    inspect() {
        const result = [];

        for(const [id, record] of this.modules) {
            result.push({
                id,
                imports : [...record.imports],
                importers : [...record.importers] 
            });
        }

        return result;
    }

    getImporters(moduleId) {
        const record = this.getModule(moduleId);

        if(!record) {
            return [];
        }

        return [...record.importers];
    }

    findImportChain(moduleId) {
        const normalizeModuleId = this.normalizeModuleid(moduleId);

        if(!normalizeModuleId) {
            return [];
        }

        const visited = new Set();

        const result = [];

        const queue = [normalizeModuleId];

        while(queue.length > 0){
            const currentId = queue.shift();

            if(visited.has(currentId)){
                continue;
            }

            visited.add(currentId);

            const record = this.getModule(currentId);

            if(!record) {
                continue;
            }

            result.push({
                id: currentId,
                importers: [...record.importers],
            });

            for(const importedId of record.importers) {
                queue.push(importedId);
            }
        }

        return result;
    }
}

module.exports = {
    ModuleGraph,
}