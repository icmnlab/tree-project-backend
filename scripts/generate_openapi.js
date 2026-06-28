#!/usr/bin/env node
/**
 * Generate openapi.yaml from Express route files + app.js mount table.
 * Run: node scripts/generate_openapi.js
 * Output: openapi/openapi.yaml (OpenAPI 3.0.3)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'routes');
const OUT_DIR = path.join(ROOT, 'openapi');
const OUT_FILE = path.join(OUT_DIR, 'openapi.yaml');

/** Prefix on apiRouter from app.js (order matters for longest-prefix) */
const MOUNTS = [
  { file: 'users.js', prefix: '' },
  { file: 'projects.js', prefix: '/projects' },
  { file: 'project_areas.js', prefix: '/project_areas' },
  { file: 'treeSurvey.js', prefix: '/tree_survey' },
  { file: 'treeSpecies.js', prefix: '/tree_species' },
  { file: 'tree_statuses.js', prefix: '/tree-statuses' },
  { file: 'reports.js', prefix: '' },
  { file: 'statistics.js', prefix: '/tree_statistics' },
  { file: 'ai.js', prefix: '' },
  { file: 'admin.js', prefix: '/admin' },
  { file: 'location.js', prefix: '/location' },
  { file: 'management.js', prefix: '/tree-management' },
  { file: 'speciesIdentification.js', prefix: '/species' },
  { file: 'pending_measurements.js', prefix: '/pending-measurements' },
  { file: 'maintenance_locks.js', prefix: '/maintenance-locks' },
  { file: 'project_boundaries.js', prefix: '/project-boundaries' },
  { file: 'ml_training_data.js', prefix: '/ml-training' },
  { file: 'tree_images.js', prefix: '/tree-images' },
  { file: 'ml_service.js', prefix: '/ml-service' },
  { file: 'csvImport.js', prefix: '/admin/import-csv' },
  { file: 'ipBlacklist.js', prefix: '/admin/ip-blacklist' },
  { file: 'research_dataset.js', prefix: '/admin/research-dataset' },
  { file: 'agent.js', prefix: '/agent' },
];

const PUBLIC_PATHS = [
  { method: 'get', path: '/health', summary: 'Liveness probe', security: false },
  { method: 'post', path: '/webhook/deploy', summary: 'GitHub deploy webhook (HMAC)', security: false },
  { method: 'get', path: '/webhook/status', summary: 'Deploy log tail (X-Admin-Token)', security: false },
];

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

function extractRoutes(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const routes = [];
  let m;
  while ((m = ROUTE_RE.exec(content)) !== null) {
    routes.push({ method: m[1].toLowerCase(), path: m[2] });
  }
  return routes;
}

function normalizeApiPath(routePath, prefix) {
  let p = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const base = prefix + p;
  const full = '/api' + base.replace(/\/+/g, '/');
  return full.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

function yamlEscape(s) {
  return s.replace(/'/g, "''");
}

function buildYaml(paths) {
  const sorted = [...paths].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const lines = [];
  lines.push('openapi: 3.0.3');
  lines.push('info:');
  lines.push('  title: Sustainable TreeAI API');
  lines.push('  description: |');
  lines.push('    Auto-generated from Express route files. Human-readable catalog: tree-project-frontend/docs/API_REFERENCE.md');
  lines.push('    Regenerate: `node scripts/generate_openapi.js`');
  lines.push('  version: 1.0.0');
  lines.push('  license:');
  lines.push('    name: MIT');
  lines.push('servers:');
  lines.push('  - url: https://{host}');
  lines.push('    description: Deployment host (paths include /api prefix where applicable)');
  lines.push('    variables:');
  lines.push('      host:');
  lines.push("        default: your-server.example.com");
  lines.push('components:');
  lines.push('  securitySchemes:');
  lines.push('    bearerAuth:');
  lines.push('      type: http');
  lines.push('      scheme: bearer');
  lines.push('      bearerFormat: JWT');
  lines.push('      description: Token from POST /api/login');
  lines.push('  schemas:');
  lines.push('    ErrorResponse:');
  lines.push('      type: object');
  lines.push('      properties:');
  lines.push('        success:');
  lines.push('          type: boolean');
  lines.push('          example: false');
  lines.push('        message:');
  lines.push('          type: string');
  lines.push('paths:');

  let currentPath = null;
  for (const entry of sorted) {
    if (entry.path !== currentPath) {
      currentPath = entry.path;
      lines.push(`  '${yamlEscape(entry.path)}':`);
    }
    lines.push(`    ${entry.method}:`);
    lines.push(`      summary: ${entry.summary || entry.method.toUpperCase()}`);
    if (entry.security !== false) {
      lines.push('      security:');
      lines.push('        - bearerAuth: []');
    }
    lines.push('      responses:');
    lines.push("        '200':");
    lines.push('          description: Success');
    lines.push("        '401':");
    lines.push('          description: Unauthorized');
    lines.push('          content:');
    lines.push('            application/json:');
    lines.push('              schema:');
    lines.push('                $ref: \'#/components/schemas/ErrorResponse\'');
  }

  lines.push('');
  return lines.join('\n');
}

function main() {
  const pathMap = new Map();

  for (const pub of PUBLIC_PATHS) {
    const key = `${pub.method}:${pub.path}`;
    pathMap.set(key, { method: pub.method, path: pub.path, summary: pub.summary, security: pub.security });
  }

  for (const mount of MOUNTS) {
    const filePath = path.join(ROUTES_DIR, mount.file);
    if (!fs.existsSync(filePath)) {
      console.warn('Skip missing:', mount.file);
      continue;
    }
    const routes = extractRoutes(filePath);
    for (const r of routes) {
      const fullPath = normalizeApiPath(r.path, mount.prefix);
      const key = `${r.method}:${fullPath}`;
      if (!pathMap.has(key)) {
        pathMap.set(key, {
          method: r.method,
          path: fullPath,
          summary: `${mount.file} ${r.path}`,
        });
      }
    }
  }

  const paths = Array.from(pathMap.values());
  console.log(`Collected ${paths.length} path operations`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, buildYaml(paths), 'utf8');
  console.log('Wrote', OUT_FILE);
}

main();
