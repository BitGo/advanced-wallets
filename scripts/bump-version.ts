export {};

const { writeFileSync, mkdirSync, existsSync } = require('fs');
const path = require('path');
const https = require('https');

/**
 * Script purpose: Automatically update @bitgo-beta/ package versions in package.json
 * - Reads package.json in current directory
 * - Bumps @bitgo-beta/ packages to latest version
 * - Overwrites package.json with updated versions
 */

type BitGoBetaPackageName = `@bitgo-beta/${string}`;

function dependencyIsBitGoBetaPackage(dependency: string): dependency is BitGoBetaPackageName {
  return dependency.startsWith('@bitgo-beta/');
}

type Tag = {
  beta?: string;
  latest?: string;
};

type DistTags = {
  tags: Tag;
};

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = require(packageJsonPath);
const packageNames: BitGoBetaPackageName[] = Object.keys(packageJson.dependencies).filter(
  dependencyIsBitGoBetaPackage,
);

/**
 * Fetches distribution tags for a given package from npm registry
 */
const getDistTags = async (packageName: BitGoBetaPackageName): Promise<DistTags> => {
  return new Promise((resolve) => {
    https.get(
      `https://registry.npmjs.org/-/package/${packageName}/dist-tags`,
      (res: { on: (arg0: string, arg1: (d: any) => void) => void }) => {
        let data = '';
        res.on('data', (d) => {
          data += d;
        });
        res.on('end', () => {
          const tags = JSON.parse(data) as Tag;
          resolve({ tags });
        });
      },
    );
  });
};

/**
 * Updates package version to latest in package.json
 */
const bumpVersion = async (packageName: BitGoBetaPackageName) => {
  const { tags } = await getDistTags(packageName);

  // Prefer beta tag if available, otherwise use latest
  const next = tags['beta'] || tags['latest'];

  if (next) {
    packageJson.dependencies[packageName] = next;
    console.log(`Upgrading ${packageName} to ${packageJson.dependencies[packageName]}...`);

    // Update resolutions if the package is in resolutions
    if (packageJson.resolutions && packageJson.resolutions[packageName]) {
      packageJson.resolutions[packageName] = next;
      console.log(`Updating resolution for ${packageName} to ${next}...`);
    }
  } else {
    console.log(`No suitable version found for ${packageName}, keeping current version`);
  }

  return;
};

const bumpVersions = async () => {
  const bumpPromises = packageNames.map(bumpVersion);
  await Promise.all(bumpPromises);

  const targetDir = path.join(process.cwd());

  // Ensure scripts directory exists
  const scriptsDir = path.join(targetDir, 'scripts');
  if (!existsSync(scriptsDir)) {
    mkdirSync(scriptsDir, { recursive: true });
  }

  writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

  console.log(`Successfully bumped ${packageJson.name} dependencies`);
};

void bumpVersions();