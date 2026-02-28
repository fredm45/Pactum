// Generate simple placeholder GLB models using Three.js
const fs = require('fs');
const path = require('path');

// This script creates minimal valid GLB files
// Since we can't easily generate proper GLB without dependencies,
// we'll download from a reliable CDN

const https = require('https');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Downloaded: ${dest}`);
          resolve();
        });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      } else {
        fs.unlink(dest, () => {});
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  const modelsDir = path.join(__dirname, '..', 'public', 'models');

  // Use Three.js examples from official CDN
  const modelUrl = 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb';

  console.log('Downloading RobotExpressive model from Three.js examples...\n');

  try {
    // Download to temp file
    const tempFile = path.join(modelsDir, 'temp.glb');
    await downloadFile(modelUrl, tempFile);

    // Copy as buyer and seller
    fs.copyFileSync(tempFile, path.join(modelsDir, 'buyer.glb'));
    fs.copyFileSync(tempFile, path.join(modelsDir, 'seller.glb'));

    // Remove temp file
    fs.unlinkSync(tempFile);

    console.log('\n✅ Success!');
    console.log('Created:');
    console.log('  - public/models/buyer.glb');
    console.log('  - public/models/seller.glb');

    // Show file sizes
    const buyerSize = fs.statSync(path.join(modelsDir, 'buyer.glb')).size;
    const sellerSize = fs.statSync(path.join(modelsDir, 'seller.glb')).size;
    console.log(`\nFile sizes:`);
    console.log(`  - buyer.glb: ${(buyerSize / 1024).toFixed(1)} KB`);
    console.log(`  - seller.glb: ${(sellerSize / 1024).toFixed(1)} KB`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nFallback: Please download models manually from:');
    console.log('https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb');
    process.exit(1);
  }
}

main();
