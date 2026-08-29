#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { startDevServer } = require('../lib/dev-server');

const args = process.argv.slice(2);
const command = args[0];

function formatPageName(fileName) {
  const extension = path.extname(fileName);

  const nameWithoutExtension = path.basename(fileName, extension);

  return nameWithoutExtension
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRootRelativePath(filePath) {
  const currentDirectory = path.dirname(filePath);

  let relativePath = path.relative(currentDirectory, process.cwd());

  if (!relativePath) {
    return './';
  }

  relativePath = relativePath.replace(/\\/g, '/');

  return `${relativePath}/`;
}

function createProject(projectName) {
  if (!projectName) {
    console.error('Please provide a project name.');
    console.log('Example: vli create my-project');
    process.exit(1);
  }

  const projectPath = path.join(process.cwd(), projectName);

  const templatePath = path.join(__dirname, '..', 'templates', 'vanilla');

  if (fs.existsSync(projectPath)) {
    console.error(`Project "${projectName}" already exists.`);

    process.exit(1);
  }

  if (!fs.existsSync(templatePath)) {
    console.error('Vanilla template not found.');
    process.exit(1);
  }

  fs.mkdirSync(projectPath, {
    recursive: true,
  });

  fs.cpSync(templatePath, projectPath, {
    recursive: true,
  });

  const indexPath = path.join(projectPath, 'index.html');

  let indexContent = fs.readFileSync(indexPath, 'utf8');

  indexContent = indexContent.replaceAll('{{PROJECT_NAME}}', projectName);

  fs.writeFileSync(indexPath, indexContent, 'utf8');

  console.log('');
  console.log(`Project "${projectName}" created successfully.`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${projectName}`);
  console.log('  vli run');
  console.log('');
}

function addFile(fileName) {
  if (!fileName) {
    console.error('Please provide a file name with extension.');

    console.log('Example: vli add pages/about.html');

    process.exit(1);
  }

  const extension = path.extname(fileName);

  if (!extension) {
    console.error('File extension is required.');

    console.log('Example: vli add pages/about.html');

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

  let fileContent = '';

  if (extension.toLowerCase() === '.html') {
    const templatePath = path.join(__dirname, '..', 'templates', 'page.html');

    if (!fs.existsSync(templatePath)) {
      console.error('HTML page template not found.');
      process.exit(1);
    }

    const pageName = formatPageName(fileName);

    const rootRelativePath = getRootRelativePath(filePath);

    const stylePath = `${rootRelativePath}style.css`;

    const scriptPath = `${rootRelativePath}script.js`;

    fileContent = fs.readFileSync(templatePath, 'utf8');

    fileContent = fileContent
      .replaceAll('{{PAGE_NAME}}', pageName)
      .replaceAll('{{STYLE_PATH}}', stylePath)
      .replaceAll('{{SCRIPT_PATH}}', scriptPath);
  }

  fs.writeFileSync(filePath, fileContent, 'utf8');

  console.log(`Created ${fileName}`);
}

function showHelp() {
  console.log(`
VLI - Vanilla CLI

Commands:

  vli create <project-name>
  vli add <file-name>
  vli run
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

switch (command) {
  case 'create':
    createProject(args[1]);
    break;

  case 'add':
    addFile(args[1]);
    break;

  case 'run':
    startDevServer();
    break;

  case 'help':
    showHelp();
    break;

  default:
    showHelp();
}
