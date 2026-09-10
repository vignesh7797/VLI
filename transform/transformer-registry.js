class TransformerRegistry {
    constructor() {
        this.transformers = new Map();
    }

    register(extension, transformer) {
        if(typeof extension !== 'string' || !extension.startsWith('.')) {
            throw new Error(`[VLI TRANSFORM] Invalid extension: ${extension}`);
        }

        if(!transformer || typeof transformer.transform !== 'function') {
            throw new Error(`[VLI TRANSFORM] Transformer for "${extension}" must provide transform()`);            
        }

        this.transformers.set(extension, transformer);

        console.log("[VLI TRANSFORM] Registered:", extension);
    }

    has(extension) {
        return this.transformers.has(extension);
    }

    get(extension) {
        return (this.transformers.get(extension) ?? null);
    }

    getExtensions() {
        return [...this.transformers.keys()];
    }
}

module.exports = { TransformerRegistry };