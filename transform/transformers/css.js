const cssTransformer = {
  name: "css",

  async transform(source, context) {
    console.log("[VLI CSS TRANSFORM] Transforming:", {
      id: context.id,

      mode: context.mode,
    });

    /**
     * B2.4.1:
     *
     * CSS remains CSS.
     *
     * Later milestones can add:
     * - @import processing
     * - url() rewriting
     * - minification
     * - CSS modules
     */
    return {
      code: source,

      type: "css",
    };
  },
};

module.exports = {
  cssTransformer,
};
