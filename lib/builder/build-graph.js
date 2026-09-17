class BundleGraph {
    constructor() {
        this.modules = new Map();
    }

    addModule({ id, type = 'js', code, imports = [], exports = [], dynamicImports = [] }) {

        if (this.modules.has(id)) {
            console.log('[VLI BUNDLE GRAPH] Module already registered:', id);

            return this.modules.get(id);
        }

        const record = {
            id,
            type,
            code,
            imports: new Set(imports),
            exports: new Set(exports),
            dynamicImports: new Set(dynamicImports),
            importers: new Set(),
        };

        this.modules.set(id, record);

        console.log('[VLI BUNDLE GRAPH] Module added:', { id, type });

        return record;
    }

    getModule(id) {
        return (
            this.modules.get(id) ?? null
        );
    }

    hasModule(id) {
        return this.modules.has(id);
    }

    linkImporters() {
        console.log('[VLI BUNDLE GRAPH] Linking importers');

        for (const moduleRecord of this.modules.values()) {

            moduleRecord.importers.clear();

        }

        for (const moduleRecord of this.modules.values()) {

            for (const dependencyId of moduleRecord.imports) {
                const dependency = this.modules.get(dependencyId);

                if (!dependency) {
                    continue;
                }

                dependency.importers.add(moduleRecord.id);
            }
        }
    }

    inspect() {
        const result = {}

        for (const [id, moduleRecord] of this.modules) {
            result[id] = {
                type: moduleRecord.type,
                imports: [...moduleRecord.imports],
                exports: [...moduleRecord.exports],
                dynamicImports: [...moduleRecord.dynamicImports],
                importers: [...moduleRecord.importers]
            };
        }

        return result;
    }

    getModuleIds() {
        return [...this.modules.keys()];
    }

    /**
   * Useful from B2.4 onward.
   *
   * Example:
   *
   * graph.getModulesByType('css')
   */
    getModulesByType(type) {

        return [
            ...this.modules.values()
        ].filter(
            (moduleRecord) =>
                moduleRecord.type === type
        );
    }
}

module.exports = {
    BundleGraph
}