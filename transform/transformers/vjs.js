const { parseVli } = require("../vli/parser");
const { generateVliModule } = require("../vli/generator");

const vjsTransformer = {
  name: "vormir-vjs",
  async transform(source, context) {
    console.log('==========================================');
    
    console.log("[VORMIR COMPILER] Compiling:", context.id);

    const parsed = parseVli(source, context);

    const code = generateVliModule(parsed, context);

    console.log("[VORMIR COMPILER] Compile completed", context.id);

    console.log('==========================================');

    return {
      code,
      type: "js",
    };
  },
};

module.exports = { vjsTransformer };
