const fs = require('fs');
const path = require('path');

const root = process.cwd();
const vercelDir = path.join(root, '.vercel');
const projectPath = path.join(vercelDir, 'project.json');

const project = {
  projectId: process.env.VERCEL_PROJECT_ID || 'prj_wTliLPHm6IRMVL2DjVCEyRtyb2tA',
  orgId: process.env.VERCEL_ORG_ID || 'team_jm6CjyLf6B90x0OMw5Fdlhgu',
  projectName: process.env.VERCEL_PROJECT_NAME || 'justin-dashboard',
  settings: {
    framework: null,
    devCommand: null,
    installCommand: null,
    buildCommand: null,
    outputDirectory: null,
    rootDirectory: null,
    directoryListing: false,
    nodeVersion: '24.x'
  }
};

fs.mkdirSync(vercelDir, { recursive: true });
fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
console.log('Prepared local Vercel project settings for build verification.');
