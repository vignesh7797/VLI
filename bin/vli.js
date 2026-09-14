#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { askTemplate } = require("../lib/template-prompt");
const {
  createProjectFromTemplate,
  isSupportedTemplate,
} = require("../lib/template-service");
const { startDevServer } = require("../lib/dev-server");
const { buildProject } = require("../lib/builder/build")

const args = process.argv.slice(2);
const command = args.shift();
const projectName = args[1];

function formatPageName(fileName) {
  const extension = path.extname(fileName);

  const nameWithoutExtension = path.basename(fileName, extension);

  return nameWithoutExtension
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRootRelativePath(filePath) {
  const currentDirectory = path.dirname(filePath);

  let relativePath = path.relative(currentDirectory, process.cwd());

  if (!relativePath) {
    return "./";
  }

  relativePath = relativePath.replace(/\\/g, "/");

  return `${relativePath}/`;
}

function createProject(projectName) {
  if (!projectName) {
    console.error("Please provide a project name.");
    console.log("Example: vli create my-project");
    process.exit(1);
  }

  const projectPath = path.join(process.cwd(), projectName);

  const templatePath = path.join(__dirname, "..", "templates", "vanilla");

  if (fs.existsSync(projectPath)) {
    console.error(`Project "${projectName}" already exists.`);

    process.exit(1);
  }

  if (!fs.existsSync(templatePath)) {
    console.error("Vanilla template not found.");
    process.exit(1);
  }

  fs.mkdirSync(projectPath, {
    recursive: true,
  });

  fs.cpSync(templatePath, projectPath, {
    recursive: true,
  });

  const indexPath = path.join(projectPath, "index.html");

  let indexContent = fs.readFileSync(indexPath, "utf8");

  indexContent = indexContent.replaceAll("{{PROJECT_NAME}}", projectName);

  fs.writeFileSync(indexPath, indexContent, "utf8");

  console.log("");
  console.log(`Project "${projectName}" created successfully.`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${projectName}`);
  console.log("  vli run");
  console.log("");
}

async function handleCreate(args) {
  const projectName = args[0];

  if (!projectName) {
    console.error("Usage: vli create <project-name>");

    process.exit(1);
  }

  let template = getOptionValue(args, "template");

  if (!template) {
    template = await askTemplate();
  }

  template = template.toLowerCase();

  if (!isSupportedTemplate(template)) {
    console.error(`[VLI] Unknown template "${template}".`);

    console.log("[VLI] Available:", getSupportedTemplates().join(", "));

    process.exit(1);
  }

  const projectPath = path.resolve(process.cwd(), projectName);

  if (require("fs").existsSync(projectPath)) {
    console.error("[VLI] Folder already exists:", projectName);
    process.exit(1);
  }

  console.log("");
  console.log("[VLI] Creating project...");
  console.log("[VLI] Project:", projectName);
  console.log("[VLI] Template:", template);

  createProjectFromTemplate({
    projectName,
    projectPath,
    template,
  });

  console.log("");
  console.log("Project created successfully!");
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${projectName}`);
  console.log("  vli run");
  console.log("");
}

function getOptionValue(
  args,
  optionName
) {

  const prefix =
    `--${optionName}=`;


  const inlineArgument =
    args.find(
      (arg) =>
        arg.startsWith(
          prefix
        )
    );


  if (
    inlineArgument
  ) {

    return inlineArgument
      .slice(
        prefix.length
      );
  }


  const optionIndex =
    args.indexOf(
      `--${optionName}`
    );


  if (
    optionIndex !== -1 &&
    args[
      optionIndex + 1
    ]
  ) {

    return args[
      optionIndex + 1
    ];
  }


  return null;
}

function addFile(fileName) {
  if (!fileName) {
    console.error("Please provide a file name with extension.");

    console.log("Example: vli add pages/about.html");

    process.exit(1);
  }

  const extension = path.extname(fileName);

  if (!extension) {
    console.error("File extension is required.");

    console.log("Example: vli add pages/about.html");

    process.exit(1);
  }

  const filePath = path.join(process.cwd(), fileName);

  if (fs.existsSync(filePath)) {
    console.error(`File "${fileName}" already exists.`);

    process.exit(1);
  }

  const directoryPath = path.dirname(filePath);

  fs.mkdirSync(directoryPath, {
    recursive: true,
  });

  let fileContent = "";

  if (extension.toLowerCase() === ".html") {
    const templatePath = path.join(__dirname, "..", "templates", "page.html");

    if (!fs.existsSync(templatePath)) {
      console.error("HTML page template not found.");
      process.exit(1);
    }

    const pageName = formatPageName(fileName);

    const rootRelativePath = getRootRelativePath(filePath);

    const stylePath = `${rootRelativePath}style.css`;

    const scriptPath = `${rootRelativePath}script.js`;

    fileContent = fs.readFileSync(templatePath, "utf8");

    fileContent = fileContent
      .replaceAll("{{PAGE_NAME}}", pageName)
      .replaceAll("{{STYLE_PATH}}", stylePath)
      .replaceAll("{{SCRIPT_PATH}}", scriptPath);
  }

  fs.writeFileSync(filePath, fileContent, "utf8");

  console.log(`Created ${fileName}`);
}

function showHelp() {
  console.log(`
VLI - Vormir CLI

Commands:

  vli create <project-name>
  vli add <file-name>
  vli run
  vli build
  vli help

Examples:

  vli create portfolio

  cd portfolio

  vli add about.html
  vli add pages/contact.html
  vli add pages/admin/users.html
  vli add css/custom.css
  vli add js/utils.js

  vli run
`);
}

async function handleBuild(){
    const projectRoot = process.cwd();

    console.log('[VLI] Build requested');

    await buildProject({projectRoot});
}

async function main() {
  switch (command) {
    case "create":
      await handleCreate(args);
      break;

    case "add":
      addFile(args[1]);
      break;

    case "run":
      startDevServer();
      break;

    case "help":
      showHelp();
      break;
    
    case "build":
      await handleBuild();
      break;

    default:
      showHelp();
  }
}

main().catch((error) => {
  console.error("[VLI] Fatal error:", error);
  process.exit(1);
});
