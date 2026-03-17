/**
 * E2E Test Helpers
 * 
 * Utilities for test isolation and unique resource naming
 */

import { test } from "@playwright/test";

/**
 * Generate a unique room name for test isolation
 * Format: {baseName}-W{workerIndex}-{timestamp}
 * 
 * @param baseName - Base name for the room
 * @returns Unique room name with worker index and timestamp
 */
export function generateUniqueRoomName(baseName: string): string {
  const workerIndex = test.info().workerIndex;
  const timestamp = Date.now();
  return `${baseName}-W${workerIndex}-${timestamp}`;
}

/**
 * Generate a unique username for test isolation
 * Format: {baseName}-W{workerIndex}-{timestamp}
 * 
 * @param baseName - Base name for the user
 * @returns Unique username with worker index and timestamp
 */
export function generateUniqueUserName(baseName: string): string {
  const workerIndex = test.info().workerIndex;
  const timestamp = Date.now();
  return `${baseName}-W${workerIndex}-${timestamp}`;
}

/**
 * Generate a unique search term for test isolation
 * Format: {baseTerm}-W{workerIndex}-{timestamp}
 * 
 * @param baseTerm - Base search term
 * @returns Unique search term with worker index and timestamp
 */
export function generateUniqueSearchTerm(baseTerm: string): string {
  const workerIndex = test.info().workerIndex;
  const timestamp = Date.now();
  return `${baseTerm}-W${workerIndex}-${timestamp}`;
}

/**
 * Wait for a specific amount of time
 * Use sparingly - prefer explicit waits on elements
 * 
 * @param ms - Milliseconds to wait
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
