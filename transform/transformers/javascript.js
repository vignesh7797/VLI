const javascriptTransformer = {
    name: 'javascript',
    async transform(source, context) {
        console.log("[VLI TRANSFORM] Javascript:", context.id);

        return {
            code: source,
            type: 'js',
        }
    }
}

module.exports =  { javascriptTransformer }