class BundleGraph {
    constructor() {
        this.modules = new Map();
    }

    addModule({id, code, imports=[], exports=[], dynamicImports=[]}) {
        const record = {
            id, 
            code, 
            imports: new Set(imports),
            exports : new Set(exports),
            dynamicImports : new Set(dynamicImports),
            importers : new Set(),
        };

        this.modules.set(id, record);

        console.log('[VLI BUNDLE GRAPH] Module added:', id);

        return record;
    }

    getModule(id) {
        return (
            this.modules.get(id) ?? null
        );
    }

    hasModule(id){
        return this.modules.has(id);
    }

    linkImporters() {
        console.log('[VLI BUNDLE GRAPH] Linking importers');

        for(const moduleRecord of this.modules.values()) {

            for(const dependencyId of moduleRecord.imports) {
                const dependency = this.modules.get(dependencyId);

                if(!dependency) {
                    continue;
                }

                dependency.importers.add(moduleRecord.id);
            }
        }
    }

    inspect() {
        const result = {}

        for(const [id, moduleRecord] of this.modules) {
            result[id] = {
                imports : [...moduleRecord.imports],
                exports : [...moduleRecord.exports],
                importers : [...moduleRecord.importers]
            };
        }

        return result;
    }

    getModuleIds() {
        return [...this.modules.keys()];
    }
}

module.exports ={
    BundleGraph
}