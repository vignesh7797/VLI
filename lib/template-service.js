const fs = require("fs");
const path = require("path");

const SUPPORTED_TEMPLATES = ["vanilla", "vormir"];

function getSupportedTemplates() {
  return [...SUPPORTED_TEMPLATES];
}

function isSupportedTemplate(templateName) {
  return SUPPORTED_TEMPLATES.includes(templateName);
}

function copyTemplateDirectory(
  sourceDirectory,
  destinationDirectory,
  projectName,
) {
  fs.mkdirSync(destinationDirectory, {
    recursive: true,
  });

  const entries = fs.readdirSync(sourceDirectory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);

    const destinationPath = path.join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, destinationPath, projectName);
      continue;
    }

    let content = fs.readFileSync(sourcePath, "utf-8");

    /**
     * Project-name injection
     */

    content = content.replaceAll("{{PROJECT_NAME}}", projectName);

    fs.writeFileSync(destinationPath, content, "utf-8");

    console.log("[VLI TEMPLATE] Created:", destinationPath);
  }
}

function createProjectFromTemplate({projectName, projectPath, template}) {
    if(!isSupportedTemplate(template)) {
        throw new Error(`Template "${template}". Available templates: ${getSupportedTemplates().join(", ")}`);
    }

    const templateDirectory = path.join(__dirname, "..", "templates", template);

    console.log('[VLI TEMPLATE] Using:', template);
    
    console.log('[VLI TEMPLATE] Source:', templateDirectory);

    copyTemplateDirectory(templateDirectory, projectPath, projectName);

    console.log('[VLI TEMPLATE] Project created successfully at:', projectPath);
}

module.exports = {
    getSupportedTemplates,
    isSupportedTemplate,
    createProjectFromTemplate,
}