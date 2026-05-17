const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Building ModuleLabs Attendance Backend...\n');

// Create build directory
const buildDir = './dist';
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true });
}
fs.mkdirSync(buildDir);

// Copy required files
console.log('📁 Copying files...');
const filesToCopy = [
  'server.js',
  'package.json',
  'package-lock.json',
  'ecosystem.config.js'
];

filesToCopy.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(buildDir, file));
  }
});

// Create uploads directory
fs.mkdirSync(path.join(buildDir, 'uploads'));
fs.mkdirSync(path.join(buildDir, 'uploads/faces'));

// Create .env file for production
console.log('🔧 Creating production .env file...');
const envContent = `
NODE_ENV=production
PORT=5000
DB_HOST=193.203.184.152
DB_USER=u816304761_my_task
DB_PASSWORD=K*@*YZRVsgsSL3A
DB_NAME=u816304761_my_task
JWT_SECRET=modulelabs_secret_2024
`;
fs.writeFileSync(path.join(buildDir, '.env'), envContent);

// Install production dependencies
console.log('📦 Installing production dependencies...');
execSync('npm install --production', { cwd: buildDir, stdio: 'inherit' });

console.log('\n✅ Build complete!');
console.log(`📁 Build location: ${path.resolve(buildDir)}`);
console.log('\n📋 To deploy:');
console.log('   1. Copy dist folder to server');
console.log('   2. Run: cd dist && npm start');
console.log('   3. Or use PM2: pm2 start ecosystem.config.js');