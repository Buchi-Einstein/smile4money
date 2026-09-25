import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gzipAsync = promisify(gzip);
const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(frontendDirectory, 'dist', 'assets');
const budgetPath = path.join(frontendDirectory, 'bundle-size-budget.json');

const budgetConfig = JSON.parse(await readFile(budgetPath, 'utf8'));
const assetNames = await readdir(outputDirectory);
const assets = assetNames.filter((assetName) => {
  return budgetConfig.budgets.some((budget) => budget.extensions.includes(path.extname(assetName)));
});

if (assets.length === 0) {
  throw new Error(`No bundle assets found in ${path.relative(frontendDirectory, outputDirectory)}`);
}

const violations = [];

for (const assetName of assets) {
  const assetPath = path.join(outputDirectory, assetName);
  const compressedSize = (await gzipAsync(await readFile(assetPath))).length;
  const budget = budgetConfig.budgets.find((candidate) =>
    candidate.extensions.includes(path.extname(assetName)),
  );

  if (compressedSize > budget.maxGzipBytes) {
    violations.push({ assetName, compressedSize, budget });
  }

  console.log(
    `${assetName}: ${compressedSize} bytes gzipped / ${budget.maxGzipBytes} byte budget`,
  );
}

if (violations.length > 0) {
  console.error('\nBundle size budget exceeded:');
  for (const { assetName, compressedSize, budget } of violations) {
    console.error(
      `- ${assetName} is ${compressedSize} bytes gzipped, exceeding the ${budget.name} budget of ${budget.maxGzipBytes} bytes`,
    );
  }
  process.exitCode = 1;
}