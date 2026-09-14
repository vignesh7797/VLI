const path = require("path");

async function transformSource({ id, source, registry, mode = "development" }) {
  const extension = path.extname(id);

  console.log("[VLI TRANSFORM] Request:", {
    id,
    extension,
    mode,
  });

  const transformer = registry.get(extension);

  if (!transformer) {
    console.log("[VLI TRANSFORM] No transformer:", extension);

    return {
      code: source,
      type: null,
      transformed: false,
    };
  }

  console.log("[VLI TRANSFORM] Using:", transformer.name);

  const result = await transformer.transform(source, { id, extension, mode });

  if (!result || typeof result.code !== "string") {
    throw new Error(
      `[VLI TRANSFORM] "${transformer.name}" returned an invalid result for ${id}`,
    );
  }

  console.log("[VLI TRANSFORM] Complete:", { id, mode });

  return {
    ...result,
    transformed: true,
  };
}

module.exports = { transformSource };
