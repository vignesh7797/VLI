const fs = require('fs');
const path = require('path');

class ModuleResolver {
    constructor({projectRoot, registry}) {
        this.projectRoot = projectRoot;
        this.registry = registry;
    }

    resolve(importerId, importPath) {
        console.log("[VLI RESOLVE] Request:", {
            importerId,
            importPath
        });


        if(typeof importPath !== 'string' || !importPath.startsWith('.')) {
            console.log("[VLI RESOLVE] Skipping non-relative import:", importPath);
            return null;
        }

        const importerDirectory = path.posix.dirname(importerId);

        const unresolvedId = path.posix.join(importerDirectory, importPath);

        const normalizedId = unresolvedId.startsWith('/') ? unresolvedId : '/' + unresolvedId;

        console.log('[VLI RESOLVE] Candidate base:', normalizedId);

        /**
         * 1. Exact file
         * ./math.js
         */
        const exactResult = this.tryFile(normalizedId);

        if(exactResult) {
            console.log('[VLI RESOLVE] Exact match:', exactResult);
            return exactResult;
        }

        /**
         * 2. Extensions file
         * ./math -> ./math.js
         */
        const extensions = this.registry.getExtensions();

        console.log('[VLI RESOLVE] Trying extensions:', extensions);
        
        for(const extension of extensions) {
            const candidate = normalizedId + extension;

            console.log('[VLI RESOLVE] Trying:', candidate);
            
            const resolved = this.tryFile(candidate);

            if(resolved) {
                console.log('[VLI RESOLVE] Resolved extensionless import:', importPath, '->', resolved);
                return resolved;
            }
        }

        /**
         * 3. DIrectory index
         * ./math -> ./math/index.js
         */
        const directoryExists = this.tryDirectory(normalizedId);

        if(directoryExists){
            console.log('[VLI RESOLVE] Directory found:', normalizedId);
            
            for(const extension of extensions) {
                const indexCandidate = path.posix.join(normalizedId, 'index' + extension);

                console.log('[VLI RESOLVE] Trying directory index:', indexCandidate);
                
                const resolvedIndex = this.tryFile(indexCandidate);

                if(resolvedIndex) {
                    console.log('[VLI RESOLVE] Directory index:', importPath, '->', resolvedIndex);
                    
                    return resolvedIndex;
                }
            }
        }

        console.warn('[VLI RESOLVE] Unable to resolve:', {
            importerId, 
            importPath
        });
        
        return null;
        
    }


    tryFile(moduleId) {
        const absolutePath = this.toAbsolutePath(moduleId);

        if(!absolutePath) return null;

        if(!fs.existsSync(absolutePath)){return null;}

        const stat = fs.statSync(absolutePath);

        if(!stat.isFile()){return null;}

        return moduleId;
    }

    tryDirectory(moduleId) {
        const absolutePath = this.toAbsolutePath(moduleId);

        if(!absolutePath) return false;

        if(!fs.existsSync(absolutePath)) return false;

        const stat = fs.statSync(absolutePath);

        return stat.isDirectory();
    }

    toAbsolutePath(moduleId) {
        const relativePath = moduleId.startsWith('/') ? moduleId.slice(1) : moduleId;

        const absolutePath = path.resolve(this.projectRoot, relativePath);

        const relativeToRoot = path.relative(this.projectRoot, absolutePath);

        if(relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)){
            console.warn('[VLI RESOLVE] Blocked outside-project path:', moduleId);

            return null;
        }

        return absolutePath;
    }
}

module.exports = { ModuleResolver }