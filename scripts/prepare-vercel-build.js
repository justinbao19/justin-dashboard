const fs = require('fs');
const path = require('path');

const root = process.cwd();
const vercelDir = path.join(root, '.vercel');
const projectPath = path.join(vercelDir, 'project.json');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const project = {
  projectId: process.env.VERCEL_PROJECT_ID || 'prj_wTliLPHm6IRMVL2DjVCEyRtyb2tA',
  orgId: process.env.VERCEL_ORG_ID || 'team_jm6CjyLf6B90x0OMw5Fdlhgu',
  projectName: process.env.VERCEL_PROJECT_NAME || 'justin-pulse',
  settings: {
    framework: null,
    devCommand: null,
    installCommand: null,
    buildCommand: null,
    outputDirectory: vercelConfig.outputDirectory,
    rootDirectory: null,
    directoryListing: false,
    nodeVersion: '24.x'
  }
};

fs.mkdirSync(vercelDir, { recursive: true });
fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
console.log('Prepared local Vercel project settings for build verification.');
