import { config } from 'dotenv';
config({ path: '.env.local' });

import { Sandbox } from '@vercel/sandbox';

async function main() {
  console.log('Creating sandbox...');
  const sandbox = await Sandbox.getOrCreate({
    name: 'my-sandbox-779612',
    persistent: true,
    networkPolicy: 'deny-all',
  });

  try {
    // Ensure the network policy is set
    console.log('Updating network policy...');
    await sandbox.update({ networkPolicy: 'deny-all' });

    // Write /vercel/generated.mjs inside the sandbox
    console.log('Writing /vercel/generated.mjs inside sandbox...');
    await sandbox.writeFiles([
      {
        path: '/vercel/generated.mjs',
        content: Buffer.from('console.log(\'Hello from generated code\');'),
      }
    ]);

    // Run the generated code
    console.log('Running /vercel/generated.mjs...');
    const result = await sandbox.runCommand('node', ['/vercel/generated.mjs']);
    
    // Print output
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    
    if (stdout) {
      console.log('STDOUT:', stdout.trim());
    }
    if (stderr) {
      console.error('STDERR:', stderr.trim());
    }
    
    // Exit with the same code as the command
    process.exit(result.exitCode);
  } finally {
    // Stop the sandbox
    console.log('Stopping sandbox...');
    await sandbox.stop();
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});