/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Copied exactly from packages/cli/src/config/extension.ts, last PR #1026

import {
  GEMINI_DIR,
  type MCPServerConfig,
  type ExtensionInstallMetadata,
  type GeminiCLIExtension,
  homedir,
} from '@google/gemini-cli-core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

export const EXTENSIONS_DIRECTORY_NAME = path.join(GEMINI_DIR, 'extensions');
export const EXTENSIONS_CONFIG_FILENAME = 'gemini-extension.json';
export const INSTALL_METADATA_FILENAME = '.gemini-extension-install.json';

/**
 * Extension definition as written to disk in gemini-extension.json files.
 * This should *not* be referenced outside of the logic for reading files.
 * If information is required for manipulating extensions (load, unload, update)
 * outside of the loading process that data needs to be stored on the
 * GeminiCLIExtension class defined in Core.
 */
interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
}

export async function loadExtensions(
  workspaceDir: string,
): Promise<GeminiCLIExtension[]> {
  const allExtensions = [
    ...(await loadExtensionsFromDir(workspaceDir)),
    ...(await loadExtensionsFromDir(homedir())),
  ];

  const uniqueExtensions: GeminiCLIExtension[] = [];
  const seenNames = new Set<string>();
  for (const extension of allExtensions) {
    if (!seenNames.has(extension.name)) {
      logger.info(
        `Loading extension: ${extension.name} (version: ${extension.version})`,
      );
      uniqueExtensions.push(extension);
      seenNames.add(extension.name);
    }
  }

  return uniqueExtensions;
}

async function loadExtensionsFromDir(
  dir: string,
): Promise<GeminiCLIExtension[]> {
  const extensionsDir = path.join(dir, EXTENSIONS_DIRECTORY_NAME);

  try {
    await fs.access(extensionsDir);
  } catch {
    return [];
  }

  const extensions: GeminiCLIExtension[] = [];
  const subdirs = await fs.readdir(extensionsDir);

  for (const subdir of subdirs) {
    const extensionDir = path.join(extensionsDir, subdir);

    const extension = await loadExtension(extensionDir);
    if (extension != null) {
      extensions.push(extension);
    }
  }
  return extensions;
}

async function loadExtension(
  extensionDir: string,
): Promise<GeminiCLIExtension | null> {
  let stats;
  try {
    stats = await fs.stat(extensionDir);
  } catch {
    return null;
  }

  if (!stats.isDirectory()) {
    logger.error(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return null;
  }

  const configFilePath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);

  try {
    await fs.access(configFilePath);
  } catch {
    logger.error(
      `Warning: extension directory ${extensionDir} does not contain a config file ${configFilePath}.`,
    );
    return null;
  }

  try {
    const configContent = await fs.readFile(configFilePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const config = JSON.parse(configContent) as ExtensionConfig;
    if (!config.name || !config.version) {
      logger.error(
        `Invalid extension config in ${configFilePath}: missing name or version.`,
      );
      return null;
    }

    const installMetadata = await loadInstallMetadata(extensionDir);

    const contextFileNames = getContextFileNames(config);
    const contextFiles: string[] = [];

    for (const contextFileName of contextFileNames) {
      const contextFilePath = path.join(extensionDir, contextFileName);
      try {
        await fs.access(contextFilePath);
        contextFiles.push(contextFilePath);
      } catch {
        // File doesn't exist, skip it
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {
      name: config.name,
      version: config.version,
      path: extensionDir,
      contextFiles,
      installMetadata,
      mcpServers: config.mcpServers,
      excludeTools: config.excludeTools,
      isActive: true, // Barring any other signals extensions should be considered Active.
    } as GeminiCLIExtension;
  } catch (e) {
    logger.error(
      `Warning: error parsing extension config in ${configFilePath}: ${e}`,
    );
    return null;
  }
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (!config.contextFileName) {
    return ['GEMINI.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

export async function loadInstallMetadata(
  extensionDir: string,
): Promise<ExtensionInstallMetadata | undefined> {
  const metadataFilePath = path.join(extensionDir, INSTALL_METADATA_FILENAME);
  try {
    const configContent = await fs.readFile(metadataFilePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metadata = JSON.parse(configContent) as ExtensionInstallMetadata;
    return metadata;
  } catch (e) {
    logger.warn(
      `Failed to load or parse extension install metadata at ${metadataFilePath}: ${e}`,
    );
    return undefined;
  }
}
