import { parse } from '@babel/parser';
import traverse, { type Scope } from '@babel/traverse';
import * as t from '@babel/types';

export interface DependencyUsage {
  importedNames: string[];
  usageLines: number[];
}

/** Matches both "react" and deep entry points such as "react/jsx-runtime". */
function matchesDependency(source: string, dependencyName: string): boolean {
  return source === dependencyName || source.startsWith(`${dependencyName}/`);
}

function recordReferences(scope: Scope, name: string, lines: Set<number>): void {
  const binding = scope.getBinding(name);

  for (const reference of binding?.referencePaths ?? []) {
    const line = reference.node.loc?.start.line;
    if (line) {
      lines.add(line);
    }
  }
}

function recordRequireBinding(
  declarator: t.VariableDeclarator,
  scope: Scope,
  names: Set<string>,
  lines: Set<number>,
): void {
  const { id } = declarator;

  if (t.isIdentifier(id)) {
    names.add(id.name);
    recordReferences(scope, id.name, lines);
    return;
  }

  if (!t.isObjectPattern(id)) {
    return;
  }

  for (const property of id.properties) {
    if (t.isObjectProperty(property) && t.isIdentifier(property.value)) {
      names.add(property.value.name);
      recordReferences(scope, property.value.name, lines);
    }
  }
}

/**
 * Returns undefined when the file has nothing to do with the dependency, which
 * is how the refactor phase keeps unrelated files out of the prompt. A file
 * that cannot be parsed falls back to a plain substring match so a syntax the
 * parser does not understand never causes a file to be silently skipped.
 */
export function analyzeDependencyUsage(
  code: string,
  dependencyName: string,
): DependencyUsage | undefined {
  let ast;

  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch {
    return code.includes(dependencyName) ? { importedNames: [], usageLines: [] } : undefined;
  }

  const importedNames = new Set<string>();
  const usageLines = new Set<number>();

  traverse(ast, {
    ImportDeclaration(path) {
      if (!matchesDependency(path.node.source.value, dependencyName)) {
        return;
      }

      const line = path.node.loc?.start.line;
      if (line) {
        usageLines.add(line);
      }

      for (const specifier of path.node.specifiers) {
        const local = specifier.local.name;
        importedNames.add(local);
        recordReferences(path.scope, local, usageLines);
      }
    },

    CallExpression(path) {
      const { node } = path;

      if (!t.isIdentifier(node.callee, { name: 'require' })) {
        return;
      }

      const [argument] = node.arguments;
      if (!t.isStringLiteral(argument) || !matchesDependency(argument.value, dependencyName)) {
        return;
      }

      const line = node.loc?.start.line;
      if (line) {
        usageLines.add(line);
      }

      const declarator = path.parentPath;
      if (declarator.isVariableDeclarator()) {
        recordRequireBinding(declarator.node, declarator.scope, importedNames, usageLines);
      }
    },
  });

  if (importedNames.size === 0 && usageLines.size === 0) {
    return undefined;
  }

  return {
    importedNames: [...importedNames].sort(),
    usageLines: [...usageLines].sort((a, b) => a - b),
  };
}
